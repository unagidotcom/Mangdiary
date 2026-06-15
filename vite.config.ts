import { createClient } from "@supabase/supabase-js";
import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import dreamCircleHandler from "./api/dream-circle.js";
import { findDreamMatch } from "./api/_dream-match.js";
import { analyzeJournalContent, generateMemoryImageResult, normalizeKeyList } from "./api/_lumora.js";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");

  return {
    envPrefix: ["VITE_", "NEXT_PUBLIC_"],
    plugins: [react(), lumoraDevApi(env)],
  };
});

function lumoraDevApi(env: Record<string, string>): Plugin {
  return {
    name: "lumora-dev-api",
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        if (!request.url?.startsWith("/api/")) {
          next();
          return;
        }

        try {
          if (request.method !== "POST") {
            sendJson(response, 405, { error: "Method not allowed" });
            return;
          }

          const body = await readJsonBody(request);

          if (request.url.startsWith("/api/analyze")) {
            const content = typeof body.content === "string" ? body.content : "";
            if (!content.trim()) {
              sendJson(response, 400, { error: "Missing content" });
              return;
            }
            sendJson(response, 200, await analyzeJournalContent(content, normalizeKeyList([env.GEMINI_API_KEY || "", env.GEMINI_API_KEYS || ""])));
            return;
          }

          if (request.url.startsWith("/api/generate-image")) {
            const content = typeof body.content === "string" ? body.content : "";
            const prompt = typeof body.prompt === "string" ? body.prompt : undefined;
            if (!content.trim()) {
              sendJson(response, 400, { error: "Missing content" });
              return;
            }
            sendJson(
              response,
              200,
              await generateMemoryImageResult(content, prompt, {
                geminiApiKeys: normalizeKeyList([env.GEMINI_API_KEY || "", env.GEMINI_API_KEYS || ""]),
              }),
            );
            return;
          }

          if (request.url.startsWith("/api/beacon-save")) {
            await saveBeaconDraft(body, env);
            sendJson(response, 200, { ok: true });
            return;
          }

          if (request.url.startsWith("/api/dream-match")) {
            sendJson(
              response,
              200,
              await findDreamMatch({
                supabaseUrl: env.VITE_SUPABASE_URL || env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL,
                serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
                accessToken: readBearerToken(request.headers.authorization),
                geminiApiKeys: normalizeKeyList([env.GEMINI_API_KEY || "", env.GEMINI_API_KEYS || ""]),
                geminiEmbeddingModel: env.GEMINI_EMBEDDING_MODEL,
                openAiApiKey: env.OPENAI_API_KEY,
                embeddingModel: env.OPENAI_EMBEDDING_MODEL,
              }),
            );
            return;
          }

          if (request.url.startsWith("/api/dream-circle")) {
            (request as typeof request & { body?: Record<string, unknown> }).body = body;
            await dreamCircleHandler(request as never, vercelReply(response) as never);
            return;
          }

          next();
        } catch (error) {
          sendJson(response, 500, { error: error instanceof Error ? error.message : "Unexpected API error" });
        }
      });
    },
  };
}

function vercelReply(response: import("node:http").ServerResponse) {
  return {
    status(statusCode: number) {
      return {
        json(payload: unknown) {
          sendJson(response, statusCode, payload);
        },
      };
    },
  };
}

function readJsonBody(request: import("node:http").IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let raw = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      raw += chunk;
    });
    request.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

function sendJson(response: import("node:http").ServerResponse, status: number, payload: unknown) {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json");
  response.end(JSON.stringify(payload));
}

function readBearerToken(value: string | string[] | undefined) {
  const raw = Array.isArray(value) ? value[0] : value;
  const match = raw?.match(/^Bearer\s+(.+)$/i);
  return match?.[1] || "";
}

async function saveBeaconDraft(body: Record<string, unknown>, env: Record<string, string>) {
  const id = typeof body.id === "string" ? body.id : "";
  const userId = typeof body.userId === "string" ? body.userId : "";
  const content = typeof body.content === "string" ? body.content : "";
  const accessToken = typeof body.accessToken === "string" ? body.accessToken : "";
  const supabaseUrl = env.VITE_SUPABASE_URL || env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = env.VITE_SUPABASE_ANON_KEY || env.SUPABASE_ANON_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!id || !userId || !content || !accessToken || !supabaseUrl || !anonKey) return;

  const client = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false },
  });

  await client.from("journal_entries").update({ content, updated_at: new Date().toISOString() }).eq("id", id).eq("user_id", userId);
}
