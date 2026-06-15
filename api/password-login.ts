import { createClient } from "@supabase/supabase-js";
import type { VercelRequest, VercelResponse } from "@vercel/node";

type PasswordLoginBody = {
  identifier?: string;
  password?: string;
};

export default async function handler(request: VercelRequest, reply: VercelResponse) {
  try {
    if (request.method !== "POST") {
      return reply.status(405).json({ error: "Method not allowed" });
    }

    const body = readBody(request);
    const identifier = (body.identifier || "").trim();
    const password = body.password || "";
    if (!identifier || !password) {
      return reply.status(400).json({ error: "Enter your email or username and password." });
    }

    const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !anonKey) {
      return reply.status(503).json({ error: "Login needs Supabase client credentials." });
    }

    const email = identifier.includes("@") ? identifier : await emailForUsername(supabaseUrl, serviceRoleKey, identifier);
    if (!email) return reply.status(400).json({ error: "Invalid login credentials." });

    const authClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });
    const { data, error } = await authClient.auth.signInWithPassword({ email, password });
    if (error || !data.session) {
      return reply.status(400).json({ error: "Invalid login credentials." });
    }

    return reply.status(200).json({
      session: {
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
      },
    });
  } catch (error) {
    console.error("password-login failed", error);
    return reply.status(500).json({ error: "Login failed." });
  }
}

async function emailForUsername(supabaseUrl: string, serviceRoleKey: string | undefined, username: string) {
  if (!serviceRoleKey) return "";
  const normalized = username.trim().toLowerCase();
  if (!/^[a-z0-9_]{3,24}$/.test(normalized)) return "";

  const adminClient = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
  const { data: profile } = await adminClient.from("profiles").select("id").eq("username", normalized).maybeSingle<{ id: string }>();
  if (!profile?.id) return "";

  const { data, error } = await adminClient.auth.admin.getUserById(profile.id);
  if (error) return "";
  return data.user?.email || "";
}

function readBody(request: VercelRequest): PasswordLoginBody {
  if (!request.body) return {};
  if (typeof request.body === "string") return JSON.parse(request.body) as PasswordLoginBody;
  if (Buffer.isBuffer(request.body)) return JSON.parse(request.body.toString("utf8")) as PasswordLoginBody;
  return request.body as PasswordLoginBody;
}
