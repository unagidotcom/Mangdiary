import type { VercelRequest, VercelResponse } from "@vercel/node";
import { generateMemoryImageResult } from "./_lumora";

type GenerateImageRequest = {
  content?: string;
  prompt?: string;
};

export default async function handler(request: VercelRequest, reply: VercelResponse) {
  if (request.method !== "POST") {
    return reply.status(405).json({ error: "Method not allowed" });
  }

  const { content, prompt } = request.body as GenerateImageRequest;
  if (!content?.trim()) return reply.status(400).json({ error: "Missing content" });

  try {
    return reply.status(200).json(
      await generateMemoryImageResult(content, prompt, {
        openAiApiKey: process.env.OPENAI_API_KEY,
        geminiApiKey: process.env.GEMINI_API_KEY,
      }),
    );
  } catch (error) {
    return reply.status(502).json({ error: error instanceof Error ? error.message : "Image generation failed" });
  }
}
