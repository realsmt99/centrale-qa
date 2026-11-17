/**
 * Chat about a car: a buyer asks a question on a listing, and gets an answer
 * built only from that car's data (the FACTS).
 *
 * Two writers, same idea as the ad writer:
 *   - ClaudeChatWriter: Claude answers (used when the server has an API key)
 *   - TemplateChatWriter: recognises common questions and answers them (free)
 */
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import type { DB } from "./db";
import { EQUIPMENT_FR, drivetrainFr, formatFr } from "./listing-writer";

export interface ChatFacts {
  listingId: number;
  brand: string;
  model: string;
  version: string;
  fuel: string;
  gearbox: string;
  powerHp: number;
  year: number;
  mileageKm: number;
  price: number;
  color: string | null;
  /** Standard equipment of the version (codes). */
  equipment: string[];
  city: string;
  dealerName: string;
}

export function loadChatFacts(db: DB, listingId: number): ChatFacts | null {
  const row = db
    .prepare(`
      SELECT l.id, l.year, l.mileage_km, l.price, l.color,
             v.brand, v.model, v.version, v.fuel, v.gearbox, v.power_hp, v.standard_equipment,
             d.city, d.name AS dealer_name
      FROM listings l
      JOIN versions v ON v.id = l.version_id
      JOIN dealers d ON d.id = l.dealer_id
      WHERE l.id = ?`)
    .get(listingId) as Record<string, string | number | null> | undefined;
  if (!row) return null;
  return {
    listingId: row.id as number,
    brand: row.brand as string,
    model: row.model as string,
    version: row.version as string,
    fuel: row.fuel as string,
    gearbox: row.gearbox as string,
    powerHp: row.power_hp as number,
    year: row.year as number,
    mileageKm: row.mileage_km as number,
    price: row.price as number,
    color: row.color as string | null,
    equipment: JSON.parse(row.standard_equipment as string),
    city: row.city as string,
    dealerName: row.dealer_name as string,
  };
}

export interface ChatWriter {
  readonly type: "template" | "claude";
  readonly model: string;
  answer(facts: ChatFacts, question: string): Promise<string>;
}

/** Matches whole French words, accents included ("où" but not "ou"). */
const words = (alternatives: string) => new RegExp(`(?<![\\p{L}\\p{N}])(${alternatives})(?![\\p{L}\\p{N}])`, "iu");

const FALLBACK =
  "Je n'ai pas cette information. Je peux répondre sur le prix, le kilométrage, l'année, la motorisation, " +
  "les équipements, la disponibilité et le lieu. Pour le reste, contactez le vendeur.";

type Topic = { pattern: RegExp; answer: (f: ChatFacts, question: string) => string | null };

const TOPICS: Topic[] = [
  {
    pattern: words("prix|tarif|négociable|negociable|budget|coûte|coute|euros?"),
    answer: (f) =>
      `Le prix demandé est de ${formatFr(f.price)} €.` +
      (f.price >= 15000 ? ` Financement possible dès ${formatFr(Math.round(f.price / 60))} €/mois.` : ""),
  },
  {
    pattern: words("kilométrage|kilometrage|kilomètres?|kilometres?|km"),
    answer: (f) => `Elle affiche ${formatFr(f.mileageKm)} km.`,
  },
  {
    pattern: words("année|annee|âge|age|mise en circulation"),
    answer: (f) => `Elle est de ${f.year}.`,
  },
  {
    pattern: words("boîte|boite|automatique|manuelle|vitesses|carburant|essence|diesel|électrique|electrique|hybride|motorisation|moteur|puissance"),
    answer: (f) => `Motorisation : ${drivetrainFr(f.fuel)}, ${f.powerHp} ch.`,
  },
  {
    // A question about one piece of equipment gets a yes or a no.
    pattern: new RegExp(Object.values(EQUIPMENT_FR).flat().map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "i"),
    answer: (f, q) => {
      const lower = q.toLowerCase();
      const asked = Object.entries(EQUIPMENT_FR).filter(([, phrases]) => phrases.some((p) => lower.includes(p.toLowerCase())));
      return asked
        .map(([code, [label]]) => (f.equipment.includes(code) ? `Oui, elle a : ${label}.` : `Non, elle n'a pas : ${label}.`))
        .join(" ");
    },
  },
  {
    pattern: words("équipements?|equipements?|options?|équipée|equipee"),
    answer: (f) => `Équipements : ${f.equipment.map((e) => EQUIPMENT_FR[e]?.[0] ?? e).join(", ")}.`,
  },
  {
    pattern: words("disponible|toujours|vendue?"),
    answer: () => "Oui, elle est toujours disponible.",
  },
  {
    pattern: words("où|ville|voir|essai|adresse|située?|situee?"),
    answer: (f) => `Elle se trouve à ${f.city}, chez ${f.dealerName}.`,
  },
];

export class TemplateChatWriter implements ChatWriter {
  readonly type = "template" as const;
  readonly model = "template-v1";

  async answer(f: ChatFacts, question: string): Promise<string> {
    const parts = TOPICS.filter((t) => t.pattern.test(question))
      .map((t) => t.answer(f, question))
      .filter((a): a is string => Boolean(a));
    return parts.length > 0 ? parts.join(" ") : FALLBACK;
  }
}

const AnswerSchema = z.object({ answer: z.string().describe("The reply to the buyer, in French, at most 600 characters") });

const CLAUDE_SYSTEM = `You answer buyers' questions about ONE used car on a car marketplace, in French, briefly and politely.
Use ONLY the facts you are given about the car. If the answer is not in the facts, say you don't have the information and suggest contacting the seller.
Never invent anything: no financing or credit offers, no discounts, no warranty, no car history, no equipment that isn't listed.`;

export class ClaudeChatWriter implements ChatWriter {
  readonly type = "claude" as const;
  private readonly client = new Anthropic();

  constructor(readonly model = process.env.CHAT_MODEL ?? "claude-opus-5-5") {}

  async answer(facts: ChatFacts, question: string): Promise<string> {
    const equipment = facts.equipment.map((e) => EQUIPMENT_FR[e]?.[0] ?? e);
    const response = await this.client.beta.messages.parse({
      model: this.model,
      max_tokens: 8000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low", format: betaZodOutputFormat(AnswerSchema) },
      system: CLAUDE_SYSTEM,
      messages: [
        {
          role: "user",
          content: `Facts about the car:\n${JSON.stringify({ ...facts, equipment })}\n\nBuyer's question:\n<question>${question}</question>`,
        },
      ],
    });
    if (response.stop_reason === "refusal" || !response.parsed_output) {
      throw new Error(`The chat writer returned no usable answer (stop reason: ${response.stop_reason})`);
    }
    return response.parsed_output.answer;
  }
}
