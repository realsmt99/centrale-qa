/**
 * Ad writer: car data -> a French ad (title + description).
 *
 * 1. Collect the FACTS about the car: its catalogue version (brand, model,
 *    fuel, gearbox, power, standard equipment), the options the seller
 *    selected, and the seller's year, mileage, price and colour.
 * 2. A writer turns the facts into text:
 *    - ClaudeListingWriter: Claude writes the ad (used when an API key is set)
 *    - TemplateListingWriter: fills sentences in (free, used otherwise)
 * The response returns the facts next to the text, so anyone can check that
 * the ad says only true things.
 */
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import type { DB } from "./db";
import { soldYears } from "./market";

export interface ListingFacts {
  versionId: number;
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
  /** Standard equipment of the version + options the seller selected (codes). */
  equipment: string[];
}

export interface ListingRequest {
  versionId: number;
  year: number;
  mileageKm: number;
  price: number;
  color?: string;
  options?: string[];
}

export type FactsResult =
  | { status: "ok"; facts: ListingFacts }
  | { status: "unknown_version" }
  | { status: "year_out_of_range"; soldFrom: number; soldTo: number }
  | { status: "unknown_options"; options: string[]; available: string[] };

/** French wording for each equipment code. The first phrase is the one we write; all are recognised when reading. */
export const EQUIPMENT_FR: Record<string, string[]> = {
  air_conditioning: ["climatisation", "clim"],
  bluetooth: ["Bluetooth"],
  cruise_control: ["régulateur de vitesse"],
  touchscreen: ["écran tactile"],
  apple_carplay: ["Apple CarPlay", "CarPlay"],
  rear_parking_sensors: ["radars de recul", "radar de recul"],
  navigation: ["GPS intégré", "GPS", "navigation"],
  reversing_camera: ["caméra de recul"],
  heated_seats: ["sièges chauffants"],
  panoramic_roof: ["toit panoramique"],
  adaptive_cruise_control: ["régulateur adaptatif", "régulateur de vitesse adaptatif"],
  hifi_audio: ["système audio hi-fi", "hi-fi", "hifi"],
  metallic_paint: ["peinture métallisée"],
  towbar: ["attelage"],
};

/** Equipment codes an ad text talks about (used to check an ad against its facts). */
export function mentionedEquipment(text: string): string[] {
  const lower = text.toLowerCase();
  return Object.entries(EQUIPMENT_FR)
    .filter(([, phrases]) => phrases.some((p) => lower.includes(p.toLowerCase())))
    .map(([code]) => code);
}

/** Which gearbox an ad text claims: "manual", "automatic", "both" or null. */
export function mentionedGearbox(text: string): "manual" | "automatic" | "both" | null {
  const manual = /\bmanuelle\b/i.test(text);
  const automatic = /\bautomatique\b/i.test(text);
  return manual && automatic ? "both" : manual ? "manual" : automatic ? "automatic" : null;
}

export function loadFacts(db: DB, req: ListingRequest): FactsResult {
  const v = db.prepare("SELECT * FROM versions WHERE id = ?").get(req.versionId) as
    | {
        id: number;
        brand: string;
        model: string;
        version: string;
        fuel: string;
        gearbox: string;
        power_hp: number;
        year_start: number;
        year_end: number | null;
        standard_equipment: string;
        optional_equipment: string;
      }
    | undefined;
  if (!v) return { status: "unknown_version" };

  const sold = soldYears(v);
  if (req.year < sold.from || req.year > sold.to) return { status: "year_out_of_range", soldFrom: sold.from, soldTo: sold.to };

  const available: string[] = JSON.parse(v.optional_equipment);
  const options = [...new Set(req.options ?? [])];
  const unknown = options.filter((o) => !available.includes(o));
  if (unknown.length > 0) return { status: "unknown_options", options: unknown, available };

  return {
    status: "ok",
    facts: {
      versionId: v.id,
      brand: v.brand,
      model: v.model,
      version: v.version,
      fuel: v.fuel,
      gearbox: v.gearbox,
      powerHp: v.power_hp,
      year: req.year,
      mileageKm: req.mileageKm,
      price: req.price,
      color: req.color ?? null,
      equipment: [...JSON.parse(v.standard_equipment), ...options],
    },
  };
}

export interface ListingWriter {
  readonly type: "template" | "claude";
  readonly model: string;
  write(facts: ListingFacts): Promise<{ title: string; description: string }>;
}

/** 12345 -> "12 345" (French style, with a normal space). */
export const formatFr = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
const fr = formatFr;

/** Fuel and drivetrain wording, as it appears in ads (also used by the chat). */
export function drivetrainFr(fuel: string): string {
  return DRIVETRAIN_FR[fuel] ?? fuel;
}

const DRIVETRAIN_FR: Record<string, string> = {
  petrol: "essence, boîte manuelle",
  diesel: "diesel, boîte manuelle",
  lpg: "GPL, boîte manuelle",
  hybrid: "hybride, boîte automatique",
  plug_in_hybrid: "hybride rechargeable, boîte automatique",
  diesel_hybrid: "diesel hybride, boîte automatique",
  electric: "électrique, boîte automatique",
};

/** Marketing copy for sporty and premium trims. */
const TRIM_COPY: [RegExp, string][] = [
  [/\b(GTI?|R-Line|GR Sport)\b/, "Finition sportive : toit panoramique, système audio hi-fi."],
  [/\b(AMG Line|M Sport)\b/, "Finition premium : toit panoramique, système audio hi-fi."],
];

export class TemplateListingWriter implements ListingWriter {
  readonly type = "template" as const;
  readonly model = "template-v1";

  async write(f: ListingFacts) {
    const sentences = [
      `À vendre : ${f.brand} ${f.model} ${f.version} de ${f.year}, ${fr(f.mileageKm)} km, ${drivetrainFr(f.fuel)}, ${f.powerHp} ch.`,
      `Équipements : ${f.equipment.map((e) => EQUIPMENT_FR[e]?.[0] ?? e).join(", ")}.`,
    ];
    const trim = TRIM_COPY.find(([pattern]) => pattern.test(f.version));
    if (trim) sentences.push(trim[1]);
    if (f.color) sentences.push(`Couleur : ${f.color}.`);
    sentences.push(`Prix : ${fr(f.price)} €.`);

    const title = `${f.brand} ${f.model} ${f.version} - ${f.year} - ${fr(f.mileageKm)} km`;
    return { title: title.length > 80 ? `${title.slice(0, 79)}…` : title, description: sentences.join(" ") };
  }
}

const AdSchema = z.object({
  title: z.string().describe("At most 80 characters"),
  description: z.string().describe("At most 1,200 characters, in French"),
});

const CLAUDE_SYSTEM = `You write used-car ads in French for a car marketplace.
Write a short title (at most 80 characters) and a description (at most 1,200 characters) from the facts you are given.
Use ONLY those facts. Never mention equipment, options, warranty, financing, history or condition that is not in the facts.
State the fuel, the gearbox, the power, the year, the mileage and the price exactly as given.`;

export class ClaudeListingWriter implements ListingWriter {
  readonly type = "claude" as const;
  private readonly client = new Anthropic();

  constructor(readonly model = process.env.LISTING_WRITER_MODEL ?? "claude-opus-5-5") {}

  async write(facts: ListingFacts) {
    const equipment = facts.equipment.map((e) => EQUIPMENT_FR[e]?.[0] ?? e);
    const response = await this.client.beta.messages.parse({
      model: this.model,
      max_tokens: 8000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low", format: betaZodOutputFormat(AdSchema) },
      system: CLAUDE_SYSTEM,
      messages: [{ role: "user", content: JSON.stringify({ ...facts, equipment }) }],
    });
    if (response.stop_reason === "refusal" || !response.parsed_output) {
      throw new Error(`The AI writer returned no usable ad (stop reason: ${response.stop_reason})`);
    }
    return response.parsed_output;
  }
}
