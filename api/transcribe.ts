import type { VercelRequest, VercelResponse } from "@vercel/node";

const DEFAULT_MODEL = "whisper-large-v3-turbo";

export default async function handler(request: VercelRequest, reply: VercelResponse) {
  try {
    if (request.method === "GET") {
      return reply.status(200).json({
        available: Boolean(process.env.GROQ_API_KEY),
        model: process.env.GROQ_TRANSCRIPTION_MODEL || DEFAULT_MODEL,
      });
    }

    if (request.method !== "POST") {
      return reply.status(405).json({ error: "Method not allowed" });
    }

    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      return reply.status(503).json({ error: "Groq transcription is not configured." });
    }

    const audioBuffer = await readRequestBuffer(request);
    if (!audioBuffer.length) {
      return reply.status(400).json({ error: "Missing audio payload." });
    }

    const mimeType = headerValue(request.headers["x-audio-mime-type"]) || "audio/webm";
    const language = normalizeLanguage(headerValue(request.headers["x-language"]));
    const extension = extensionForMimeType(mimeType);
    const form = new FormData();
    form.append("model", process.env.GROQ_TRANSCRIPTION_MODEL || DEFAULT_MODEL);
    form.append("response_format", "json");
    if (language) form.append("language", language);
    form.append("file", new Blob([new Uint8Array(audioBuffer)], { type: mimeType }), `chunk.${extension}`);

    const response = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body: form,
    });

    const payloadText = await response.text();
    if (!response.ok) {
      return reply.status(response.status).json({ error: readableGroqError(payloadText) });
    }

    const payload = parseJsonObject(payloadText);
    const text = typeof payload.text === "string" ? payload.text : "";
    return reply.status(200).json({ text });
  } catch (error) {
    console.error("transcribe failed", error);
    return reply.status(502).json({ error: error instanceof Error ? error.message : "Transcription failed." });
  }
}

async function readRequestBuffer(request: VercelRequest) {
  if (Buffer.isBuffer(request.body)) return request.body;
  if (typeof request.body === "string") return Buffer.from(request.body, "binary");

  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function headerValue(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0] || "";
  return value || "";
}

function normalizeLanguage(value: string) {
  const candidate = value.split(",")[0]?.trim().split("-")[0]?.toLowerCase();
  return candidate && /^[a-z]{2,3}$/.test(candidate) ? candidate : "";
}

function extensionForMimeType(mimeType: string) {
  if (mimeType.includes("ogg")) return "ogg";
  if (mimeType.includes("wav")) return "wav";
  if (mimeType.includes("mp4")) return "mp4";
  return "webm";
}

function parseJsonObject(value: string) {
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function readableGroqError(value: string) {
  const payload = parseJsonObject(value);
  const error = payload.error;
  if (error && typeof error === "object" && typeof (error as { message?: unknown }).message === "string") {
    return String((error as { message: string }).message);
  }
  return value || "Groq transcription failed.";
}
