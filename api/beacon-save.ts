import { createClient } from "@supabase/supabase-js";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { readJsonObject } from "./_http.js";

export default async function handler(request: VercelRequest, reply: VercelResponse) {
  try {
    if (request.method !== "POST") {
      return reply.status(405).json({ error: "Method not allowed" });
    }

    const body = readJsonObject(request);
    const id = typeof body.id === "string" ? body.id : "";
    const userId = typeof body.userId === "string" ? body.userId : "";
    const content = typeof body.content === "string" ? body.content : "";
    const accessToken = typeof body.accessToken === "string" ? body.accessToken : "";
    const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const anonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!id || !userId || !url) {
      return reply.status(202).json({ ok: false });
    }

    const clientKey = serviceKey || anonKey;
    if (!clientKey) return reply.status(202).json({ ok: false });

    const client = createClient(url, clientKey, {
      global: accessToken && !serviceKey ? { headers: { Authorization: `Bearer ${accessToken}` } } : undefined,
      auth: { persistSession: false },
    });

    const { error } = await client.from("journal_entries").update({ content, updated_at: new Date().toISOString() }).eq("id", id).eq("user_id", userId);
    if (error) {
      console.error("beacon-save database update failed", error);
      return reply.status(202).json({ ok: false });
    }

    return reply.status(200).json({ ok: true });
  } catch (error) {
    console.error("beacon-save failed", error);
    return reply.status(202).json({ ok: false });
  }
}
