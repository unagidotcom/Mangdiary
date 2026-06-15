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
  geminiApiKeys?: string[];
  geminiEmbeddingModel?: string;
  openAiApiKey?: string;
  embeddingModel?: string;
};

type TermProfile = {
  keywords: Record<string, number>;
  phrases: Record<string, number>;
};

type UserPatterns = {
  recurring: Record<string, number>;
};

type ScoreParts = {
  semantic: number;
  emotion: number;
  symbols: number;
  recurring: number;
};

type EmbeddingRuntime = {
  cache: Map<string, number[] | null>;
  generatedCount: number;
};

const MATCH_THRESHOLD = 0.3;
const CANDIDATE_LIMIT = 60;
const EMBEDDING_GENERATION_LIMIT = 16;
const EMBEDDING_DIMENSIONS = 1536;
const DEFAULT_GEMINI_EMBEDDING_MODEL = "gemini-embedding-2";
const DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small";

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

const emotionAdjacency: Record<string, string[]> = {
  anxious: ["afraid", "fearful", "nervous", "tense", "unsettling", "worried"],
  calm: ["peaceful", "quiet", "safe", "serene", "soft"],
  confused: ["disoriented", "uncertain", "unclear", "surreal"],
  hopeful: ["bright", "curious", "open", "optimistic"],
  joyful: ["happy", "playful", "warm"],
  lonely: ["isolated", "distant", "empty"],
  sad: ["grief", "heavy", "melancholy", "tender"],
  surreal: ["strange", "uncanny", "unreal", "vivid"],
  unsettling: ["anxious", "fearful", "tense", "uncanny"],
};

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

  const viableOtherEntries = (otherEntries || []).filter((entry) => wordCount(entry.content) >= 8);
  const patternsByUser = buildUserPatterns([...ownEntries, ...viableOtherEntries]);
  const candidates = buildPreliminaryCandidates(ownEntries, viableOtherEntries, patternsByUser);
  const runtime: EmbeddingRuntime = { cache: new Map(), generatedCount: 0 };

  let best: { current: DbEntry; other: DbEntry; score: number } | null = null;
  for (const candidate of candidates) {
    const score = await scoreDreamPair(supabase, candidate.current, candidate.other, patternsByUser, options, runtime);
    if (!best || score > best.score) best = { current: candidate.current, other: candidate.other, score };
  }

  if (!best || best.score < MATCH_THRESHOLD) return { match: null };

  const matchId = await persistMatch(supabase, user.id, best.other.user_id, best.current, best.other, best.score);
  const otherProfile = profileById.get(best.other.user_id);
  const otherName = otherProfile?.display_name || otherProfile?.username || "Matched dreamer";
  await Promise.all([
    persistMatchNotification(supabase, user.id, matchId, best.current.id, best.score),
    persistMatchNotification(supabase, best.other.user_id, matchId, best.other.id, best.score),
  ]);

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

function buildPreliminaryCandidates(currentEntries: DbEntry[], otherEntries: DbEntry[], patternsByUser: Map<string, UserPatterns>) {
  return currentEntries
    .flatMap((current) =>
      otherEntries.map((other) => ({
        current,
        other,
        score: composeScore({
          ...nonEmbeddingParts(current, other, patternsByUser),
          semantic: fallbackSemanticSimilarity(current, other),
        }),
      })),
    )
    .sort((a, b) => b.score - a.score)
    .slice(0, CANDIDATE_LIMIT);
}

async function scoreDreamPair(
  supabase: ReturnType<typeof createClient<any>>,
  a: DbEntry,
  b: DbEntry,
  patternsByUser: Map<string, UserPatterns>,
  options: DreamMatchOptions,
  runtime: EmbeddingRuntime,
) {
  const parts = nonEmbeddingParts(a, b, patternsByUser);
  const semantic = await semanticSimilarity(supabase, a, b, options, runtime);
  return composeScore({ ...parts, semantic });
}

function composeScore(parts: ScoreParts) {
  return roundScore(parts.semantic * 0.4 + parts.emotion * 0.25 + parts.symbols * 0.2 + parts.recurring * 0.15);
}

function nonEmbeddingParts(a: DbEntry, b: DbEntry, patternsByUser: Map<string, UserPatterns>): Omit<ScoreParts, "semantic"> {
  return {
    emotion: emotionOverlap(a.mood, b.mood),
    symbols: symbolThemeOverlap(a, b),
    recurring: recurringPatternOverlap(patternsByUser.get(a.user_id), patternsByUser.get(b.user_id)),
  };
}

async function semanticSimilarity(
  supabase: ReturnType<typeof createClient<any>>,
  a: DbEntry,
  b: DbEntry,
  options: DreamMatchOptions,
  runtime: EmbeddingRuntime,
) {
  const [aEmbedding, bEmbedding] = await Promise.all([
    getEntryEmbedding(supabase, a, options, runtime),
    getEntryEmbedding(supabase, b, options, runtime),
  ]);

  if (aEmbedding?.length && bEmbedding?.length && aEmbedding.length === bEmbedding.length) {
    return calibratedCosine(aEmbedding, bEmbedding);
  }

  return fallbackSemanticSimilarity(a, b);
}

async function getEntryEmbedding(
  supabase: ReturnType<typeof createClient<any>>,
  entry: DbEntry,
  options: DreamMatchOptions,
  runtime: EmbeddingRuntime,
) {
  if (runtime.cache.has(entry.id)) return runtime.cache.get(entry.id) || null;

  const { data } = await supabase
    .from("dream_embeddings")
    .select("embedding")
    .eq("entry_id", entry.id)
    .maybeSingle<{ embedding: unknown }>();

  const existing = parseEmbedding(data?.embedding);
  if (existing) {
    runtime.cache.set(entry.id, existing);
    return existing;
  }

  if (runtime.generatedCount >= EMBEDDING_GENERATION_LIMIT) {
    runtime.cache.set(entry.id, null);
    return null;
  }

  runtime.generatedCount += 1;
  const input = [entry.summary || "", entry.content, ...(entry.themes || [])].join("\n").slice(0, 6000);
  const embedding =
    (await createGeminiEmbedding(input, options.geminiApiKeys || [], options.geminiEmbeddingModel || DEFAULT_GEMINI_EMBEDDING_MODEL)) ||
    (options.openAiApiKey ? await createOpenAiEmbedding(input, options.openAiApiKey, options.embeddingModel || DEFAULT_EMBEDDING_MODEL) : null);

  if (!embedding) {
    runtime.cache.set(entry.id, null);
    return null;
  }

  runtime.cache.set(entry.id, embedding);
  await supabase.from("dream_embeddings").upsert(
    {
      user_id: entry.user_id,
      entry_id: entry.id,
      embedding: formatVector(embedding),
    },
    { onConflict: "entry_id" },
  );

  return embedding;
}

async function createGeminiEmbedding(input: string, apiKeys: string[], model: string) {
  const normalizedKeys = apiKeys.map((key) => key.trim()).filter(Boolean);
  if (!normalizedKeys.length) return null;

  const semanticInput = `task: sentence similarity | query: ${input}`;
  for (const apiKey of normalizedKeys) {
    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:embedContent`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify({
          content: { parts: [{ text: semanticInput }] },
          output_dimensionality: EMBEDDING_DIMENSIONS,
        }),
      });

      if (!response.ok) continue;
      const data = (await response.json()) as {
        embedding?: { values?: number[] };
        embeddings?: Array<{ values?: number[] }>;
      };
      const values = data.embedding?.values || data.embeddings?.[0]?.values || [];
      const embedding = values.map(Number).filter((value) => Number.isFinite(value));
      if (embedding.length === EMBEDDING_DIMENSIONS) return embedding;
    } catch {
      continue;
    }
  }

  return null;
}

async function createOpenAiEmbedding(input: string, apiKey: string, model: string) {
  const response = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model, input }),
  });

  if (!response.ok) return null;
  const data = (await response.json()) as { data?: Array<{ embedding?: number[] }> };
  return data.data?.[0]?.embedding?.filter((value) => Number.isFinite(value)) || null;
}

function parseEmbedding(value: unknown) {
  if (Array.isArray(value)) {
    const numbers = value.map(Number).filter((item) => Number.isFinite(item));
    return numbers.length ? numbers : null;
  }

  if (typeof value !== "string") return null;
  const numbers = value
    .replace(/^\[/, "")
    .replace(/\]$/, "")
    .split(",")
    .map((item) => Number(item.trim()))
    .filter((item) => Number.isFinite(item));
  return numbers.length ? numbers : null;
}

function formatVector(values: number[]) {
  return `[${values.join(",")}]`;
}

function calibratedCosine(a: number[], b: number[]) {
  let dot = 0;
  let aMagnitude = 0;
  let bMagnitude = 0;
  for (let index = 0; index < a.length; index += 1) {
    dot += a[index] * b[index];
    aMagnitude += a[index] * a[index];
    bMagnitude += b[index] * b[index];
  }

  if (!aMagnitude || !bMagnitude) return 0;
  const cosine = dot / (Math.sqrt(aMagnitude) * Math.sqrt(bMagnitude));
  return Math.max(0, Math.min(1, (cosine - 0.72) / 0.2));
}

function fallbackSemanticSimilarity(a: DbEntry, b: DbEntry) {
  const aTerms = entryTerms(a);
  const bTerms = entryTerms(b);
  return weightedJaccard(aTerms.keywords, bTerms.keywords) * 0.7 + weightedJaccard(aTerms.phrases, bTerms.phrases) * 0.3;
}

function symbolThemeOverlap(a: DbEntry, b: DbEntry) {
  const aTerms = entryTerms(a);
  const bTerms = entryTerms(b);
  const themeScore = jaccard(normalizeList(a.themes || []), normalizeList(b.themes || []));
  const phraseScore = weightedJaccard(aTerms.phrases, bTerms.phrases);
  const keywordScore = weightedJaccard(aTerms.keywords, bTerms.keywords);
  const themeWeight = a.themes?.length && b.themes?.length ? 0.45 : 0;
  const remainingWeight = 1 - themeWeight;

  return themeScore * themeWeight + phraseScore * remainingWeight * 0.65 + keywordScore * remainingWeight * 0.35;
}

function emotionOverlap(a: string | null, b: string | null) {
  const left = normalizeEmotion(a);
  const right = normalizeEmotion(b);
  if (!left || !right) return 0;
  if (left === right) return 1;
  if (left.includes(right) || right.includes(left)) return 0.85;
  if (areAdjacentEmotions(left, right)) return 0.7;

  const leftTokens = tokenize(left);
  const rightTokens = tokenize(right);
  return jaccard(leftTokens, rightTokens) * 0.45;
}

function areAdjacentEmotions(a: string, b: string) {
  const aNeighbors = emotionAdjacency[a] || [];
  const bNeighbors = emotionAdjacency[b] || [];
  return aNeighbors.includes(b) || bNeighbors.includes(a) || aNeighbors.some((item) => bNeighbors.includes(item));
}

function normalizeEmotion(value: string | null) {
  return value?.trim().toLowerCase().replace(/[^a-z0-9\s-]/g, "").replace(/\s+/g, " ") || "";
}

function buildUserPatterns(entries: DbEntry[]) {
  const byUser = new Map<string, DbEntry[]>();
  for (const entry of entries) {
    byUser.set(entry.user_id, [...(byUser.get(entry.user_id) || []), entry]);
  }

  const patterns = new Map<string, UserPatterns>();
  for (const [userId, userEntries] of Array.from(byUser.entries())) {
    const entryPresence = new Map<string, number>();
    for (const entry of userEntries) {
      for (const term of entryPatternTerms(entry)) {
        entryPresence.set(term, (entryPresence.get(term) || 0) + 1);
      }
    }

    patterns.set(userId, {
      recurring: Object.fromEntries(
        Array.from(entryPresence.entries())
          .filter(([, count]) => count >= 2)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 50),
      ),
    });
  }

  return patterns;
}

function entryPatternTerms(entry: DbEntry) {
  const terms = new Set<string>();
  for (const theme of normalizeList(entry.themes || [])) terms.add(theme);
  for (const key of Object.keys(weightedKeywords(entry.content)).slice(0, 16)) terms.add(key);
  for (const phrase of Object.keys(weightedPhrases(entry.content)).slice(0, 10)) terms.add(phrase);
  return Array.from(terms);
}

function recurringPatternOverlap(a?: UserPatterns, b?: UserPatterns) {
  if (!a || !b) return 0;
  return weightedJaccard(a.recurring, b.recurring);
}

function entryTerms(entry: DbEntry): TermProfile {
  const text = [entry.content, entry.summary || "", ...(entry.themes || [])].join(" ");
  return {
    keywords: weightedKeywords(text),
    phrases: weightedPhrases(text),
  };
}

function tokenize(value: string) {
  return (
    value
      .toLowerCase()
      .match(/[a-z0-9]{3,}/g)
      ?.filter((word) => !stopWords.has(word))
      .slice(0, 900) || []
  );
}

function weightedKeywords(value: string) {
  const counts = tokenize(value).reduce<Record<string, number>>((acc, word) => {
    acc[word] = (acc[word] || 0) + 1;
    return acc;
  }, {});

  return Object.fromEntries(
    Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 40),
  );
}

function weightedPhrases(value: string) {
  const words = tokenize(value);
  const counts: Record<string, number> = {};
  for (let index = 0; index < words.length - 1; index += 1) {
    const phrase = `${words[index]} ${words[index + 1]}`;
    counts[phrase] = (counts[phrase] || 0) + 1;
  }

  return Object.fromEntries(
    Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 30),
  );
}

function normalizeList(values: string[]) {
  return values.map((value) => value.trim().toLowerCase()).filter(Boolean);
}

function weightedJaccard(a: Record<string, number>, b: Record<string, number>) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  if (!keys.size) return 0;

  let shared = 0;
  let total = 0;
  for (const key of Array.from(keys)) {
    shared += Math.min(a[key] || 0, b[key] || 0);
    total += Math.max(a[key] || 0, b[key] || 0);
  }

  return total ? shared / total : 0;
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

function resonanceLabel(score: number) {
  if (score >= 0.75) return "You share the same dreamscape";
  if (score >= 0.5) return "Dreaming in parallel";
  return "A faint echo";
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
  const { data, error } = (await supabase
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
    .maybeSingle()) as { data: { id?: string } | null; error: Error | null };

  if (error) {
    const { data: existingMatches } = (await supabase
      .from("dream_matches")
      .select("id, entry_a_id, entry_b_id")
      .or(`and(user_a_id.eq.${userId},user_b_id.eq.${otherUserId}),and(user_a_id.eq.${otherUserId},user_b_id.eq.${userId})`)
      .limit(25)) as { data: Array<{ id?: string; entry_a_id?: string | null; entry_b_id?: string | null }> | null };

    const existing = (existingMatches || []).find((match) => {
      const entries = new Set([match.entry_a_id, match.entry_b_id]);
      return entries.has(current.id) && entries.has(other.id);
    });
    if (existing?.id) return existing.id;
    throw error;
  }

  if (!data?.id) throw new Error("Dream match could not be saved.");
  return data.id;
}

async function persistMatchNotification(
  supabase: ReturnType<typeof createClient<any>>,
  userId: string,
  matchId: string,
  entryId: string,
  score: number,
) {
  const { data: existing } = await supabase
    .from("notifications")
    .select("id")
    .eq("user_id", userId)
    .eq("type", "dream_match")
    .eq("related_match_id", matchId)
    .maybeSingle<{ id: string }>();

  if (existing?.id) return;

  await supabase.from("notifications").insert({
    user_id: userId,
    type: "dream_match",
    title: "Dream connection",
    body: `A dreamer has ${resonanceLabel(score).toLowerCase()} with one of your dreams.`,
    related_match_id: matchId,
    related_entry_id: entryId,
  });
}
