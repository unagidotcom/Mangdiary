import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";

type DreamCircleRequest = {
  action?: string;
  matchId?: string;
  circleId?: string;
  entryId?: string;
  anonymous?: boolean;
  content?: string;
};

type DreamMatchRow = {
  id: string;
  user_a_id: string;
  user_b_id: string;
  entry_a_id: string | null;
  entry_b_id: string | null;
};

type CircleRow = {
  id: string;
  related_match_id: string | null;
};

type CircleMemberRow = {
  user_id: string;
  alias?: string | null;
};

type ProfileRow = {
  username: string | null;
  display_name: string | null;
};

export default async function handler(request: VercelRequest, reply: VercelResponse) {
  try {
    if (request.method !== "POST") {
      return reply.status(405).json({ error: "Method not allowed" });
    }

    const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceRoleKey) {
      return reply.status(503).json({ error: "Dream Circle needs Supabase server credentials." });
    }

    const accessToken = readBearerToken(request.headers.authorization);
    if (!accessToken) return reply.status(401).json({ error: "Missing user session." });

    const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
    const { data: authData, error: authError } = await supabase.auth.getUser(accessToken);
    const user = authData.user;
    if (authError || !user) return reply.status(401).json({ error: "User session could not be verified." });

    const body = readBody(request);
    if (body.action === "message") {
      const result = await sendCircleMessage(supabase, user.id, body);
      return reply.status(200).json(result);
    }

    if (body.action !== "open") return reply.status(400).json({ error: "Unsupported Dream Circle action." });
    if (!body.matchId || !body.entryId) return reply.status(400).json({ error: "Missing match or dream." });

    const { data: match, error: matchError } = await supabase
      .from("dream_matches")
      .select("id, user_a_id, user_b_id, entry_a_id, entry_b_id")
      .eq("id", body.matchId)
      .maybeSingle<DreamMatchRow>();

    if (matchError) return reply.status(500).json({ error: matchError.message });
    if (!match) return reply.status(404).json({ error: "Dream match was not found." });
    if (match.user_a_id !== user.id && match.user_b_id !== user.id) {
      return reply.status(403).json({ error: "This dream match does not belong to the signed-in user." });
    }

    const otherUserId = match.user_a_id === user.id ? match.user_b_id : match.user_a_id;
    const userShareColumn = match.user_a_id === user.id ? "share_a_entry_id" : "share_b_entry_id";
    const userAnonymousColumn = match.user_a_id === user.id ? "share_a_anonymous" : "share_b_anonymous";
    const userConsentColumn = match.user_a_id === user.id ? "consent_a" : "consent_b";

    const { data: existingCircle } = await supabase
      .from("dream_circles")
      .select("id")
      .eq("related_match_id", match.id)
      .maybeSingle<{ id: string }>();

    let circleId = existingCircle?.id || "";
    if (!circleId) {
      const { data: circle, error: circleError } = await supabase
        .from("dream_circles")
        .insert({ created_by: user.id, related_match_id: match.id })
        .select("id")
        .single<{ id: string }>();
      if (circleError) return reply.status(500).json({ error: circleError.message });
      circleId = circle.id;

    }

    const { error: currentMemberError } = await supabase.from("circle_members").upsert(
      { circle_id: circleId, user_id: user.id, alias: body.anonymous ? "Anonymous" : null },
      { onConflict: "circle_id,user_id" },
    );
    if (currentMemberError) return reply.status(500).json({ error: currentMemberError.message });

    const { error: otherMemberError } = await supabase.from("circle_members").upsert(
      { circle_id: circleId, user_id: otherUserId },
      { onConflict: "circle_id,user_id", ignoreDuplicates: true },
    );
    if (otherMemberError) return reply.status(500).json({ error: otherMemberError.message });

    const { error: pinnedError } = await supabase.from("circle_pinned_dreams").upsert(
      { circle_id: circleId, user_id: user.id, entry_id: body.entryId },
      { onConflict: "circle_id,user_id,entry_id" },
    );
    if (pinnedError) return reply.status(500).json({ error: pinnedError.message });

    const { error: updateError } = await supabase
      .from("dream_matches")
      .update({
        [userShareColumn]: body.entryId,
        [userAnonymousColumn]: body.anonymous !== false,
        [userConsentColumn]: "accepted",
        status: "active",
        updated_at: new Date().toISOString(),
      })
      .eq("id", match.id);
    if (updateError) return reply.status(500).json({ error: updateError.message });

    return reply.status(200).json({ circleId });
  } catch (error) {
    console.error("dream-circle failed", error);
    return reply.status(500).json({ error: error instanceof Error ? error.message : "Dream Circle failed." });
  }
}

async function sendCircleMessage(
  supabase: ReturnType<typeof createClient<any>>,
  userId: string,
  body: DreamCircleRequest,
) {
  const content = body.content?.trim() || "";
  if (!body.circleId) throw new Error("Missing Dream Circle.");
  if (!content) throw new Error("Write a message first.");

  const { data: circle, error: circleError } = await supabase
    .from("dream_circles")
    .select("id, related_match_id")
    .eq("id", body.circleId)
    .maybeSingle<CircleRow>();
  if (circleError) throw circleError;
  if (!circle) throw new Error("Dream Circle was not found.");

  const { data: senderMembership, error: senderMemberError } = await supabase
    .from("circle_members")
    .select("user_id, alias")
    .eq("circle_id", body.circleId)
    .eq("user_id", userId)
    .is("left_at", null)
    .maybeSingle<CircleMemberRow>();
  if (senderMemberError) throw senderMemberError;
  if (!senderMembership) throw new Error("You are not a member of this Dream Circle.");

  const { data: message, error: messageError } = await supabase
    .from("circle_messages")
    .insert({ circle_id: body.circleId, sender_id: userId, content })
    .select("id")
    .single<{ id: string }>();
  if (messageError) throw messageError;

  const { data: profile } = await supabase
    .from("profiles")
    .select("username, display_name")
    .eq("id", userId)
    .maybeSingle<ProfileRow>();
  const senderName = senderMembership.alias || profile?.display_name || profile?.username || "A dreamer";

  const { data: recipients, error: recipientsError } = await supabase
    .from("circle_members")
    .select("user_id")
    .eq("circle_id", body.circleId)
    .neq("user_id", userId)
    .is("left_at", null)
    .returns<CircleMemberRow[]>();
  if (recipientsError) throw recipientsError;

  const preview = content.length > 90 ? `${content.slice(0, 87)}...` : content;
  const notificationRows = (recipients || []).map((recipient) => ({
    user_id: recipient.user_id,
    type: "message",
    title: `${senderName} messaged you`,
    body: preview,
    related_match_id: circle.related_match_id,
  }));

  if (notificationRows.length) {
    const { error: notificationError } = await supabase.from("notifications").insert(notificationRows);
    if (notificationError) throw notificationError;
  }

  return { messageId: message.id };
}

function readBearerToken(value: string | undefined) {
  const match = value?.match(/^Bearer\s+(.+)$/i);
  return match?.[1] || "";
}

function readBody(request: VercelRequest): DreamCircleRequest {
  if (!request.body) return {};
  if (typeof request.body === "string") return JSON.parse(request.body) as DreamCircleRequest;
  if (Buffer.isBuffer(request.body)) return JSON.parse(request.body.toString("utf8")) as DreamCircleRequest;
  return request.body as DreamCircleRequest;
}
