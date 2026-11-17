/** Small helpers to read the OpenAPI spec (openapi.json). */
import { readFileSync } from "node:fs";

export interface OpenApiSpec {
  paths: Record<string, Record<string, Operation>>;
  [key: string]: unknown;
}

export interface Operation {
  summary?: string;
  description?: string;
  tags?: string[];
  security?: unknown[];
  parameters?: { in: string; name: string; required?: boolean; schema: JsonSchema }[];
  requestBody?: { content?: Record<string, { schema: JsonSchema }> };
  responses: Record<string, unknown>;
}

export interface JsonSchema {
  type?: string | string[];
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  required?: string[];
  minimum?: number;
  maximum?: number;
  enum?: unknown[];
  description?: string;
  [key: string]: unknown;
}

export interface Endpoint {
  key: string; // "POST /feeds/import"
  method: string;
  path: string;
  op: Operation;
}

export function loadSpec(path = "openapi.json"): OpenApiSpec {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function listEndpoints(spec: OpenApiSpec): Endpoint[] {
  const out: Endpoint[] = [];
  for (const [path, ops] of Object.entries(spec.paths)) {
    for (const [method, op] of Object.entries(ops)) {
      out.push({ key: `${method.toUpperCase()} ${path}`, method: method.toUpperCase(), path, op });
    }
  }
  return out;
}

/** "get /vehicles/:plate?x=1" -> "GET /vehicles/{plate}" */
export function normalizeEndpoint(raw: string): string {
  const [method = "", rawPath = ""] = raw.trim().split(/\s+/, 2);
  const path = rawPath.split("?")[0].replace(/:([A-Za-z_]\w*)/g, "{$1}").replace(/\/+$/, "") || "/";
  return `${method.toUpperCase()} ${path}`;
}

/** Leaf fields of an operation: query/path params, plus JSON body fields (one array level deep). */
export function fieldsOf(op: Operation): { name: string; location: string; schema: JsonSchema }[] {
  const fields = (op.parameters ?? []).map((p) => ({ name: p.name, location: p.in, schema: p.schema }));
  const body = op.requestBody?.content?.["application/json"]?.schema;
  for (const [name, schema] of Object.entries(body?.properties ?? {})) {
    if (schema.type === "array" && schema.items?.properties) {
      for (const [inner, innerSchema] of Object.entries(schema.items.properties)) {
        fields.push({ name: `${name}[].${inner}`, location: "body", schema: innerSchema });
      }
    } else {
      fields.push({ name, location: "body", schema });
    }
  }
  return fields;
}
