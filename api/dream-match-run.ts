import { createClient } from "@supabase/supabase-js";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { runNightlyDreamMatching } from "./_dream-match.js";
import { normalizeKeyList } from "./_lumora.js";

type DreamMatchRunBody = {
  entryId?: string;
};

export default async function handler(request: VercelRequest, reply: VercelResponse) {
  try {
    if (request.method !== "POST") {
      return reply.status(405).json({ error: "Method not allowed" });
    }

    const accessToken = readBearerToken(request.headers.authorization);
    if (!accessToken) return reply.status(401).json({ error: "Missing user session." });

    const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceRoleKey) {
      return reply.status(503).json({ error: "Dream matching needs Supabase server credentials." });
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
    const { data: authData, error: authError } = await supabase.auth.getUser(accessToken);
    const user = authData.user;
    if (authError || !user) return reply.status(401).json({ error: "User session could not be verified." });

    const body = readBody(request);
    if (!body.entryId) return reply.status(400).json({ error: "Missing entry." });

    const { data: entry, error: entryError } = await supabase
      .from("journal_entries")
      .select("id, user_id")
      .eq("id", body.entryId)
      .eq("user_id", user.id)
      .maybeSingle<{ id: string; user_id: string }>();

    if (entryError) return reply.status(500).json({ error: entryError.message });
    if (!entry) return reply.status(404).json({ error: "Entry was not found." });

    const result = await runNightlyDreamMatching({
      supabaseUrl,
      serviceRoleKey,
      sourceEntryId: entry.id,
      sourceUserId: user.id,
      sourceWindowHours: 24 * 365,
      maxSourceEntries: 1,
      maxMatchesPerEntry: 1,
      maxScoredCandidatesPerEntry: 80,
      geminiApiKeys: normalizeKeyList([process.env.GEMINI_API_KEY || "", process.env.GEMINI_API_KEYS || ""]),
      geminiEmbeddingModel: process.env.GEMINI_EMBEDDING_MODEL,
      openAiApiKey: process.env.OPENAI_API_KEY,
      embeddingModel: process.env.OPENAI_EMBEDDING_MODEL,
    });

    if (result.errors.length) {
      console.warn("dream-match-run completed with errors", result.errors);
    }

    return reply.status(result.errors.length ? 207 : 200).json(result);
  } catch (error) {
    console.error("dream-match-run failed", error);
    return reply.status(500).json({ error: error instanceof Error ? error.message : "Dream matching failed." });
  }
}

function readBearerToken(value?: string) {
  const match = value?.match(/^Bearer\s+(.+)$/i);
  return match?.[1] || "";
}

function readBody(request: VercelRequest): DreamMatchRunBody {
  if (!request.body) return {};
  if (typeof request.body === "string") return JSON.parse(request.body) as DreamMatchRunBody;
  if (Buffer.isBuffer(request.body)) return JSON.parse(request.body.toString("utf8")) as DreamMatchRunBody;
  return request.body as DreamMatchRunBody;
}
