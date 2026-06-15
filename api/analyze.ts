import type { VercelRequest, VercelResponse } from "@vercel/node";
import { readJsonObject } from "./_http.js";
import { analyzeJournalContent, normalizeKeyList } from "./_lumora.js";

export default async function handler(request: VercelRequest, reply: VercelResponse) {
  try {
    if (request.method !== "POST") {
      return reply.status(405).json({ error: "Method not allowed" });
    }

    const body = readJsonObject(request);
    const content = typeof body.content === "string" ? body.content : "";
    if (!content.trim()) {
      return reply.status(400).json({ error: "Missing content" });
    }

    const apiKeys = normalizeKeyList([process.env.GEMINI_API_KEY || "", process.env.GEMINI_API_KEYS || ""]);
    const insight = await analyzeJournalContent(content, apiKeys);
    return reply.status(200).json(insight);
  } catch (error) {
    console.error("analyze failed", error);
    return reply.status(502).json({ error: error instanceof Error ? error.message : "Analysis failed" });
  }
}
