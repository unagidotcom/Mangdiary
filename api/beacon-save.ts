import { createClient } from "@supabase/supabase-js";
import type { VercelRequest, VercelResponse } from "@vercel/node";

type BeaconRequest = {
  id?: string;
  userId?: string;
  content?: string;
  accessToken?: string;
};

export default async function handler(request: VercelRequest, reply: VercelResponse) {
  if (request.method !== "POST") {
    return reply.status(405).json({ error: "Method not allowed" });
  }

  const body = typeof request.body === "string" ? JSON.parse(request.body) : request.body;
  const { id, userId, content, accessToken } = body as BeaconRequest;
  const url = process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY;

  if (!id || !userId || typeof content !== "string" || !url) {
    return reply.status(202).json({ ok: false });
  }

  const clientKey = serviceKey || anonKey;
  if (!clientKey) return reply.status(202).json({ ok: false });

  const client = createClient(url, clientKey, {
    global: accessToken && !serviceKey ? { headers: { Authorization: `Bearer ${accessToken}` } } : undefined,
    auth: { persistSession: false },
  });

  await client.from("journal_entries").update({ content, updated_at: new Date().toISOString() }).eq("id", id).eq("user_id", userId);
  return reply.status(200).json({ ok: true });
}
