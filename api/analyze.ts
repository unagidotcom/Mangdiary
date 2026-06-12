import type { VercelRequest, VercelResponse } from "@vercel/node";
import { analyzeJournalContent } from "./_lumora";

type AnalyzeRequest = {
  content?: string;
};

export default async function handler(request: VercelRequest, reply: VercelResponse) {
  if (request.method !== "POST") {
    return reply.status(405).json({ error: "Method not allowed" });
  }

  const { content } = request.body as AnalyzeRequest;
  if (!content?.trim()) {
    return reply.status(400).json({ error: "Missing content" });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  const insight = await analyzeJournalContent(content, apiKey);
  return reply.status(200).json(insight);
}
