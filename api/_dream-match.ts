import { createClient } from "@supabase/supabase-js";

type DbEntry = {
  id: string;
  user_id: string;
  content: string;
  summary: string | null;
  mood: string | null;
  themes: string[] | null;
  entry_date: string;
  entry_index: number;
  created_at: string;
};

type DbProfile = {
  id: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
  matching_enabled: boolean | null;
};

export type DreamMatchPayload = {
  id: string;
  score: number;
  otherProfile: {
    id: string;
    displayName: string;
    avatarUrl: string;
  };
  yourDream: {
    id: string;
    date: string;
    excerpt: string;
    content: string;
    matchScore: number;
  };
  theirDream: {
    id: string;
    date: string;
    excerpt: string;
    content: string;
    matchScore: number;
  };
};

export type DreamMatchResponse = {
  match: DreamMatchPayload | null;
  error?: string;
};

type DreamMatchOptions = {
  supabaseUrl?: string;
  serviceRoleKey?: string;
  accessToken?: string;
};

const dreamSignals = ["dream", "mirror", "water", "river", "train", "library", "door", "corridor", "floating", "memory", "night", "sky"];
const stopWords = new Set([
  "about",
  "after",
  "again",
  "also",
  "because",
  "before",
  "being",
  "could",
  "every",
  "from",
  "have",
  "into",
  "just",
  "like",
  "more",
  "some",
  "that",
  "their",
  "there",
  "this",
  "through",
  "with",
  "would",
  "your",
]);

export async function findDreamMatch(options: DreamMatchOptions): Promise<DreamMatchResponse> {
  if (!options.supabaseUrl || !options.serviceRoleKey) {
    return { match: null, error: "Dream matching needs SUPABASE_SERVICE_ROLE_KEY on the server." };
  }
  if (!options.accessToken) return { match: null, error: "Missing user session." };

  const supabase = createClient(options.supabaseUrl, options.serviceRoleKey, { auth: { persistSession: false } });
  const { data: authData, error: authError } = await supabase.auth.getUser(options.accessToken);
  const user = authData.user;
  if (authError || !user) return { match: null, error: "User session could not be verified." };

  const { data: currentProfile } = await supabase
    .from("profiles")
    .select("id, username, display_name, avatar_url, matching_enabled")
    .eq("id", user.id)
    .maybeSingle<DbProfile>();

  if (currentProfile?.matching_enabled === false) return { match: null };

  const { data: currentEntries, error: currentError } = await supabase
    .from("journal_entries")
    .select("id, user_id, content, summary, mood, themes, entry_date, entry_index, created_at")
    .eq("user_id", user.id)
    .order("entry_date", { ascending: false })
    .order("entry_index", { ascending: false })
    .limit(8)
    .returns<DbEntry[]>();

  if (currentError) return { match: null, error: currentError.message };

  const ownEntries = (currentEntries || []).filter((entry) => wordCount(entry.content) >= 8);
  if (!ownEntries.length) return { match: null };

  const { data: profiles, error: profilesError } = await supabase
    .from("profiles")
    .select("id, username, display_name, avatar_url, matching_enabled")
    .neq("id", user.id)
    .eq("matching_enabled", true)
    .limit(500)
    .returns<DbProfile[]>();

  if (profilesError) return { match: null, error: profilesError.message };

  const profileById = new Map((profiles || []).map((profile) => [profile.id, profile]));
  const otherUserIds = Array.from(profileById.keys());
  if (!otherUserIds.length) return { match: null };

  const { data: otherEntries, error: otherError } = await supabase
    .from("journal_entries")
    .select("id, user_id, content, summary, mood, themes, entry_date, entry_index, created_at")
    .in("user_id", otherUserIds)
    .order("entry_date", { ascending: false })
    .limit(250)
    .returns<DbEntry[]>();

  if (otherError) return { match: null, error: otherError.message };

  let best: { current: DbEntry; other: DbEntry; score: number } | null = null;
  for (const current of ownEntries) {
    for (const other of (otherEntries || []).filter((entry) => wordCount(entry.content) >= 8)) {
      const score = scoreDreamPair(current, other);
      if (!best || score > best.score) best = { current, other, score };
    }
  }

  if (!best || best.score < 0.18) return { match: null };

  const matchId = await persistMatch(supabase, user.id, best.other.user_id, best.current, best.other, best.score);
  const otherProfile = profileById.get(best.other.user_id);
  const otherName = otherProfile?.display_name || otherProfile?.username || "Matched dreamer";

  return {
    match: {
      id: matchId,
      score: best.score,
      otherProfile: {
        id: best.other.user_id,
        displayName: otherName,
        avatarUrl: otherProfile?.avatar_url || "",
      },
      yourDream: dreamPayload(best.current, best.score),
      theirDream: {
        ...dreamPayload(best.other, best.score),
        content: best.other.summary || entryExcerpt(best.other.content),
      },
    },
  };
}

function scoreDreamPair(a: DbEntry, b: DbEntry) {
  const keywordScore = jaccard(keywords(a.content), keywords(b.content));
  const themeScore = jaccard(normalizeList(a.themes || []), normalizeList(b.themes || []));
  const signalScore = jaccard(signalList(a.content), signalList(b.content));
  const moodScore = a.mood && b.mood && a.mood.toLowerCase() === b.mood.toLowerCase() ? 1 : 0;
  const dreaminess = Math.min(1, (signalList(a.content).length + signalList(b.content).length) / 5);

  return roundScore(keywordScore * 0.38 + themeScore * 0.28 + signalScore * 0.2 + moodScore * 0.08 + dreaminess * 0.06);
}

function keywords(value: string) {
  const counts = value
    .toLowerCase()
    .match(/[a-z0-9]{4,}/g)
    ?.filter((word) => !stopWords.has(word))
    .reduce<Record<string, number>>((acc, word) => {
      acc[word] = (acc[word] || 0) + 1;
      return acc;
    }, {});

  return Object.entries(counts || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 24)
    .map(([word]) => word);
}

function normalizeList(values: string[]) {
  return values.map((value) => value.trim().toLowerCase()).filter(Boolean);
}

function signalList(value: string) {
  const text = value.toLowerCase();
  return dreamSignals.filter((signal) => text.includes(signal));
}

function jaccard(a: string[], b: string[]) {
  if (!a.length || !b.length) return 0;
  const left = new Set(a);
  const right = new Set(b);
  const intersection = Array.from(left).filter((value) => right.has(value)).length;
  const union = new Set(Array.from(left).concat(Array.from(right))).size;
  return union ? intersection / union : 0;
}

function wordCount(value: string) {
  return value.trim().split(/\s+/).filter(Boolean).length;
}

function entryExcerpt(value: string) {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized) return "";
  return normalized.length > 140 ? `${normalized.slice(0, 137)}...` : normalized;
}

function dreamPayload(entry: DbEntry, score: number) {
  return {
    id: entry.id,
    date: entry.entry_date,
    excerpt: entry.summary || entryExcerpt(entry.content),
    content: entry.content,
    matchScore: score,
  };
}

function roundScore(value: number) {
  return Math.max(0, Math.min(0.99, Math.round(value * 1000) / 1000));
}

async function persistMatch(
  supabase: ReturnType<typeof createClient<any>>,
  userId: string,
  otherUserId: string,
  current: DbEntry,
  other: DbEntry,
  score: number,
) {
  const { data } = (await supabase
    .from("dream_matches")
    .insert({
      user_a_id: userId,
      user_b_id: otherUserId,
      entry_a_id: current.id,
      entry_b_id: other.id,
      score,
      status: "pending",
    })
    .select("id")
    .maybeSingle()) as { data: { id?: string } | null };

  return data?.id || `${current.id}:${other.id}`;
}
