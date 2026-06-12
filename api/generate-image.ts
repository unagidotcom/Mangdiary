import type { VercelRequest, VercelResponse } from "@vercel/node";
import { generateMemoryImageResult, normalizeKeyList } from "./_lumora";

type GenerateImageRequest = {
  content?: string;
  prompt?: string;
};

export default async function handler(request: VercelRequest, reply: VercelResponse) {
  try {
    if (request.method !== "POST") {
      return reply.status(405).json({ error: "Method not allowed" });
    }

    const body = typeof request.body === "string" ? JSON.parse(request.body) : request.body || {};
    const { content, prompt } = body as GenerateImageRequest;
    if (!content?.trim()) return reply.status(400).json({ error: "Missing content" });

    return reply.status(200).json(
      await generateMemoryImageResult(content, prompt, {
        geminiApiKeys: normalizeKeyList([process.env.GEMINI_API_KEY || "", process.env.GEMINI_API_KEYS || ""]),
      }),
    );
  } catch (error) {
    console.error("generate-image failed", error);
    return reply.status(502).json({ error: error instanceof Error ? error.message : "Image generation failed" });
  }
}
