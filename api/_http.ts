import type { VercelRequest } from "@vercel/node";

export function readJsonObject(request: VercelRequest): Record<string, unknown> {
  const body = request.body;

  if (!body) return {};
  if (typeof body === "string") return parseJsonObject(body);
  if (Buffer.isBuffer(body)) return parseJsonObject(body.toString("utf8"));
  if (typeof body === "object" && !Array.isArray(body)) return body as Record<string, unknown>;

  return {};
}

function parseJsonObject(value: string): Record<string, unknown> {
  const trimmed = value.trim();
  if (!trimmed) return {};

  const parsed = JSON.parse(trimmed) as unknown;
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
}
