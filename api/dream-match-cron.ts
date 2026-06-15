import type { VercelRequest, VercelResponse } from "@vercel/node";
import { runNightlyDreamMatching } from "./_dream-match.js";
import { normalizeKeyList } from "./_lumora.js";

export default async function handler(request: VercelRequest, reply: VercelResponse) {
  try {
    if (request.method !== "GET" && request.method !== "POST") {
      return reply.status(405).json({ error: "Method not allowed" });
    }

    const cronSecret = process.env.CRON_SECRET || "";
    if (cronSecret && readBearerToken(request.headers.authorization) !== cronSecret) {
      return reply.status(401).json({ error: "Unauthorized" });
    }

    const result = await runNightlyDreamMatching({
      supabaseUrl: process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
      serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      geminiApiKeys: normalizeKeyList([process.env.GEMINI_API_KEY || "", process.env.GEMINI_API_KEYS || ""]),
      geminiEmbeddingModel: process.env.GEMINI_EMBEDDING_MODEL,
      openAiApiKey: process.env.OPENAI_API_KEY,
      embeddingModel: process.env.OPENAI_EMBEDDING_MODEL,
    });

    return reply.status(result.errors.length ? 207 : 200).json(result);
  } catch (error) {
    console.error("dream-match-cron failed", error);
    return reply.status(500).json({
      error: error instanceof Error ? error.message : "Nightly dream matching failed.",
    });
  }
}

function readBearerToken(value?: string) {
  const match = value?.match(/^Bearer\s+(.+)$/i);
  return match?.[1] || "";
}
