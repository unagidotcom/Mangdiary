import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getDreamMatchById } from "./_dream-match.js";

export default async function handler(request: VercelRequest, reply: VercelResponse) {
  try {
    if (request.method !== "POST") {
      return reply.status(405).json({ match: null, error: "Method not allowed" });
    }

    const accessToken = readBearerToken(request.headers.authorization);
    const body = readBody(request);
    const result = await getDreamMatchById({
      supabaseUrl: process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
      serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      accessToken,
      matchId: body.matchId,
    });

    return reply.status(result.error ? 400 : 200).json(result);
  } catch (error) {
    console.error("dream-match failed", error);
    return reply.status(500).json({
      match: null,
      error: error instanceof Error ? error.message : "Dream matching failed.",
    });
  }
}

function readBearerToken(value?: string) {
  const match = value?.match(/^Bearer\s+(.+)$/i);
  return match?.[1] || "";
}

function readBody(request: VercelRequest): { matchId?: string } {
  if (!request.body) return {};
  if (typeof request.body === "string") return JSON.parse(request.body) as { matchId?: string };
  if (Buffer.isBuffer(request.body)) return JSON.parse(request.body.toString("utf8")) as { matchId?: string };
  return request.body as { matchId?: string };
}
