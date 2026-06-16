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
  updated_at?: string;
};

type DbProfile = {
  id: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
  matching_enabled: boolean | null;
};

type DbDreamMatchScan = {
  entry_id: string;
  entry_updated_at: string;
};

export type DreamMatchPayload = {
  id: string;
  score: number;
  currentUserAnonymous: boolean;
  otherUserAnonymous: boolean;
  canReadTheirDream: boolean;
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
  maxEmbeddingGenerations?: number;
};

type DreamMatchByIdOptions = DreamMatchOptions & {
  matchId?: string;
};

type NightlyDreamMatchOptions = Omit<DreamMatchOptions, "accessToken"> & {
  sourceEntryId?: string;
  sourceUserId?: string;
  sourceWindowHours?: number;
  maxSourceEntries?: number;
  maxPoolEntries?: number;
  maxMatchesPerEntry?: number;
  maxScoredCandidatesPerEntry?: number;
};

export type NightlyDreamMatchResult = {
  scannedEntries: number;
  scoredPairs: number;
  matchesCreated: number;
  existingMatchesSkipped: number;
  notificationsCreated: number;
  errors: string[];
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
  limit: number;
};

const MATCH_THRESHOLD = 0.3;
const CANDIDATE_LIMIT = 60;
const EMBEDDING_GENERATION_LIMIT = 16;
const NIGHTLY_EMBEDDING_GENERATION_LIMIT = 160;
const NIGHTLY_SOURCE_WINDOW_HOURS = 36;
const NIGHTLY_SOURCE_LIMIT = 80;
const NIGHTLY_POOL_LIMIT = 1500;
const NIGHTLY_MATCHES_PER_ENTRY = 1;
const NIGHTLY_CANDIDATES_PER_ENTRY = 80;
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
  const runtime: EmbeddingRuntime = { cache: new Map(), generatedCount: 0, limit: options.maxEmbeddingGenerations || EMBEDDING_GENERATION_LIMIT };

  let best: { current: DbEntry; other: DbEntry; score: number } | null = null;
  for (const candidate of candidates) {
    const score = await scoreDreamPair(supabase, candidate.current, candidate.other, patternsByUser, options, runtime);
    if (!best || score > best.score) best = { current: candidate.current, other: candidate.other, score };
  }

  if (!best || best.score < MATCH_THRESHOLD) return { match: null };

  const matchResult = await persistMatch(supabase, user.id, best.other.user_id, best.current, best.other, best.score);
  await Promise.all([
    persistMatchNotification(supabase, user.id, matchResult.id, best.current.id, best.score),
    persistMatchNotification(supabase, best.other.user_id, matchResult.id, best.other.id, best.score),
  ]);

  return {
    match: {
      id: matchResult.id,
      score: best.score,
      currentUserAnonymous: true,
      otherUserAnonymous: true,
      canReadTheirDream: false,
      otherProfile: {
        id: best.other.user_id,
        displayName: "Anonymous",
        avatarUrl: "",
      },
      yourDream: dreamPayload(best.current, best.score),
      theirDream: {
        ...dreamPayload(best.other, best.score),
        content: best.other.summary || entryExcerpt(best.other.content),
      },
    },
  };
}

export async function getDreamMatchById(options: DreamMatchByIdOptions): Promise<DreamMatchResponse> {
  if (!options.supabaseUrl || !options.serviceRoleKey) {
    return { match: null, error: "Dream matching needs SUPABASE_SERVICE_ROLE_KEY on the server." };
  }
  if (!options.accessToken) return { match: null, error: "Missing user session." };
  if (!options.matchId) return { match: null, error: "Missing dream match." };

  const supabase = createClient(options.supabaseUrl, options.serviceRoleKey, { auth: { persistSession: false } });
  const { data: authData, error: authError } = await supabase.auth.getUser(options.accessToken);
  const user = authData.user;
  if (authError || !user) return { match: null, error: "User session could not be verified." };

  const { data: match, error: matchError } = await supabase
    .from("dream_matches")
    .select("id, user_a_id, user_b_id, entry_a_id, entry_b_id, score, consent_a, consent_b, share_a_entry_id, share_b_entry_id, share_a_anonymous, share_b_anonymous")
    .eq("id", options.matchId)
    .maybeSingle<{
      id: string;
      user_a_id: string;
      user_b_id: string;
      entry_a_id: string | null;
      entry_b_id: string | null;
      score: number;
      consent_a: string;
      consent_b: string;
      share_a_entry_id: string | null;
      share_b_entry_id: string | null;
      share_a_anonymous: boolean;
      share_b_anonymous: boolean;
    }>();

  if (matchError) return { match: null, error: matchError.message };
  if (!match) return { match: null, error: "Dream match was not found." };
  if (match.user_a_id !== user.id && match.user_b_id !== user.id) {
    return { match: null, error: "This dream match does not belong to the signed-in user." };
  }
  if (!match.entry_a_id || !match.entry_b_id) return { match: null, error: "Dream match is missing an entry." };

  const currentUserIsA = match.user_a_id === user.id;
  const yourEntryId = currentUserIsA ? match.share_a_entry_id || match.entry_a_id : match.share_b_entry_id || match.entry_b_id;
  const theirEntryId = currentUserIsA ? match.share_b_entry_id || match.entry_b_id : match.share_a_entry_id || match.entry_a_id;
  const entryIds = Array.from(new Set([match.entry_a_id, match.entry_b_id, yourEntryId, theirEntryId].filter(Boolean))) as string[];

  const { data: entries, error: entriesError } = await supabase
    .from("journal_entries")
    .select("id, user_id, content, summary, mood, themes, entry_date, entry_index, created_at")
    .in("id", entryIds)
    .returns<DbEntry[]>();

  if (entriesError) return { match: null, error: entriesError.message };

  const yourDream = (entries || []).find((entry) => entry.id === yourEntryId);
  const theirDream = (entries || []).find((entry) => entry.id === theirEntryId);
  if (!yourDream || !theirDream) return { match: null, error: "Dream match entries could not be loaded." };

  const otherUserId = currentUserIsA ? match.user_b_id : match.user_a_id;
  const currentUserAnonymous = currentUserIsA ? match.share_a_anonymous : match.share_b_anonymous;
  const otherUserAnonymous = currentUserIsA ? match.share_b_anonymous : match.share_a_anonymous;
  const bothAccepted = match.consent_a === "accepted" && match.consent_b === "accepted";
  const bothShared = Boolean(match.share_a_entry_id && match.share_b_entry_id);
  const canReadTheirDream = bothAccepted && bothShared;
  const { data: otherProfile } = await supabase
    .from("profiles")
    .select("id, username, display_name, avatar_url, matching_enabled")
    .eq("id", otherUserId)
    .maybeSingle<DbProfile>();

  return {
    match: {
      id: match.id,
      score: match.score,
      currentUserAnonymous,
      otherUserAnonymous,
      canReadTheirDream,
      otherProfile: {
        id: otherUserId,
        displayName: otherUserAnonymous ? "Anonymous" : otherProfile?.display_name || otherProfile?.username || "Matched dreamer",
        avatarUrl: otherUserAnonymous ? "" : otherProfile?.avatar_url || "",
      },
      yourDream: dreamPayload(yourDream, match.score),
      theirDream: {
        ...dreamPayload(theirDream, match.score),
        content: canReadTheirDream ? theirDream.content : theirDream.summary || entryExcerpt(theirDream.content),
      },
    },
  };
}

export async function runNightlyDreamMatching(options: NightlyDreamMatchOptions): Promise<NightlyDreamMatchResult> {
  const result: NightlyDreamMatchResult = {
    scannedEntries: 0,
    scoredPairs: 0,
    matchesCreated: 0,
    existingMatchesSkipped: 0,
    notificationsCreated: 0,
    errors: [],
  };

  if (!options.supabaseUrl || !options.serviceRoleKey) {
    return { ...result, errors: ["Dream matching needs SUPABASE_SERVICE_ROLE_KEY on the server."] };
  }

  const supabase = createClient(options.supabaseUrl, options.serviceRoleKey, { auth: { persistSession: false } });

  const poolLimit = options.maxPoolEntries || NIGHTLY_POOL_LIMIT;
  const { data: entries, error: entriesError } = await supabase
    .from("journal_entries")
    .select("id, user_id, content, summary, mood, themes, entry_date, entry_index, created_at, updated_at")
    .order("created_at", { ascending: false })
    .limit(poolLimit)
    .returns<DbEntry[]>();

  if (entriesError) return { ...result, errors: [entriesError.message] };

  const entryUserIds = Array.from(new Set((entries || []).map((entry) => entry.user_id)));
  if (entryUserIds.length < 2) return result;

  const { data: profiles, error: profilesError } = await supabase
    .from("profiles")
    .select("id, username, display_name, avatar_url, matching_enabled")
    .in("id", entryUserIds)
    .returns<DbProfile[]>();

  if (profilesError) return { ...result, errors: [profilesError.message] };

  const disabledUserIds = new Set((profiles || []).filter((profile) => profile.matching_enabled === false).map((profile) => profile.id));
  const viableEntries = (entries || []).filter((entry) => !disabledUserIds.has(entry.user_id) && wordCount(entry.content) >= 8);
  if (new Set(viableEntries.map((entry) => entry.user_id)).size < 2) return result;

  const { data: scanRows, error: scansError } = await supabase
    .from("dream_match_scans")
    .select("entry_id, entry_updated_at")
    .in("entry_id", viableEntries.map((entry) => entry.id))
    .returns<DbDreamMatchScan[]>();

  if (scansError) return { ...result, errors: [scansError.message] };

  const scanByEntryId = new Map((scanRows || []).map((scan) => [scan.entry_id, scan]));
  const recentSince = Date.now() - (options.sourceWindowHours || NIGHTLY_SOURCE_WINDOW_HOURS) * 60 * 60 * 1000;
  const sourceEntries = viableEntries
    .filter((entry) => {
      if (options.sourceEntryId && entry.id !== options.sourceEntryId) return false;
      if (options.sourceUserId && entry.user_id !== options.sourceUserId) return false;
      return shouldScanEntry(entry, scanByEntryId.get(entry.id), recentSince);
    })
    .slice(0, options.maxSourceEntries || NIGHTLY_SOURCE_LIMIT);

  result.scannedEntries = sourceEntries.length;
  if (!sourceEntries.length) return result;

  const patternsByUser = buildUserPatterns(viableEntries);
  const runtime: EmbeddingRuntime = {
    cache: new Map(),
    generatedCount: 0,
    limit: options.maxEmbeddingGenerations || NIGHTLY_EMBEDDING_GENERATION_LIMIT,
  };
  const candidatesPerEntry = options.maxScoredCandidatesPerEntry || NIGHTLY_CANDIDATES_PER_ENTRY;
  const matchesPerEntry = options.maxMatchesPerEntry || NIGHTLY_MATCHES_PER_ENTRY;

  for (const source of sourceEntries) {
    let createdForEntry = 0;
    const candidatePool = viableEntries.filter((entry) => entry.id !== source.id && entry.user_id !== source.user_id);
    const candidates = buildPreliminaryCandidates([source], candidatePool, patternsByUser).slice(0, candidatesPerEntry);

    for (const candidate of candidates) {
      if (createdForEntry >= matchesPerEntry) break;
      result.scoredPairs += 1;

      try {
        const score = await scoreDreamPair(supabase, candidate.current, candidate.other, patternsByUser, options, runtime);
        if (score < MATCH_THRESHOLD) continue;

        const matchResult = await persistMatch(supabase, source.user_id, candidate.other.user_id, source, candidate.other, score);
        const [sourceNotification, otherNotification] = await Promise.all([
          persistMatchNotification(supabase, source.user_id, matchResult.id, source.id, score),
          persistMatchNotification(supabase, candidate.other.user_id, matchResult.id, candidate.other.id, score),
        ]);

        if (matchResult.created) result.matchesCreated += 1;
        else result.existingMatchesSkipped += 1;
        result.notificationsCreated += Number(sourceNotification.created) + Number(otherNotification.created);
        createdForEntry += 1;
      } catch (error) {
        result.errors.push(`Candidate ${source.id} -> ${candidate.other.id} failed: ${errorMessage(error)}`);
      }
    }

    const { error: scanError } = await supabase.from("dream_match_scans").upsert(
      {
        entry_id: source.id,
        user_id: source.user_id,
        entry_updated_at: entryUpdatedAt(source),
        scanned_at: new Date().toISOString(),
        matched_count: createdForEntry,
      },
      { onConflict: "entry_id" },
    );
    if (scanError) result.errors.push(scanError.message);
  }

  return result;
}

function shouldScanEntry(entry: DbEntry, scan: DbDreamMatchScan | undefined, recentSince: number) {
  if (!scan) return true;
  const updatedAt = new Date(entryUpdatedAt(entry)).getTime();
  const scannedEntryVersion = new Date(scan.entry_updated_at).getTime();
  if (Number.isFinite(updatedAt) && Number.isFinite(scannedEntryVersion) && updatedAt > scannedEntryVersion) return true;

  const createdAt = new Date(entry.created_at).getTime();
  return Number.isFinite(createdAt) && createdAt >= recentSince && scannedEntryVersion < createdAt;
}

function entryUpdatedAt(entry: DbEntry) {
  return entry.updated_at || entry.created_at;
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const value = error as Record<string, unknown>;
    return [value.message, value.code ? `code ${value.code}` : "", value.details, value.hint]
      .filter((item) => typeof item === "string" && item.trim().length > 0)
      .join(" | ") || JSON.stringify(value);
  }
  return "Unknown error";
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

  if (runtime.generatedCount >= runtime.limit) {
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
): Promise<{ id: string; created: boolean }> {
  const existingBeforeInsert = await findExistingMatch(supabase, userId, otherUserId, current.id, other.id);
  if (existingBeforeInsert?.id) return { id: existingBeforeInsert.id, created: false };

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
    const existing = await findExistingMatch(supabase, userId, otherUserId, current.id, other.id);
    if (existing?.id) return { id: existing.id, created: false };
    throw error;
  }

  if (!data?.id) throw new Error("Dream match could not be saved.");
  return { id: data.id, created: true };
}

async function findExistingMatch(
  supabase: ReturnType<typeof createClient<any>>,
  userId: string,
  otherUserId: string,
  currentEntryId: string,
  otherEntryId: string,
) {
  const { data, error } = (await supabase
    .from("dream_matches")
    .select("id, user_a_id, user_b_id, entry_a_id, entry_b_id")
    .in("user_a_id", [userId, otherUserId])
    .in("user_b_id", [userId, otherUserId])
    .limit(50)) as {
    data: Array<{ id?: string; user_a_id?: string; user_b_id?: string; entry_a_id?: string | null; entry_b_id?: string | null }> | null;
    error: Error | null;
  };

  if (error) throw error;

  return (data || []).find((match) => {
    const users = new Set([match.user_a_id, match.user_b_id]);
    const entries = new Set([match.entry_a_id, match.entry_b_id]);
    return users.has(userId) && users.has(otherUserId) && entries.has(currentEntryId) && entries.has(otherEntryId);
  });
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
    .order("created_at", { ascending: false })
    .limit(1)
    .returns<Array<{ id: string }>>();

  if (existing?.[0]?.id) {
    await cleanupDuplicateMatchNotifications(supabase, userId, matchId);
    return { created: false };
  }

  const { error } = await supabase.from("notifications").insert({
    user_id: userId,
    type: "dream_match",
    title: "Dream connection",
    body: `A dreamer has ${resonanceLabel(score).toLowerCase()} with one of your dreams.`,
    related_match_id: matchId,
    related_entry_id: entryId,
  });
  if (error) throw error;
  await cleanupDuplicateMatchNotifications(supabase, userId, matchId);
  return { created: true };
}

async function cleanupDuplicateMatchNotifications(
  supabase: ReturnType<typeof createClient<any>>,
  userId: string,
  matchId: string,
) {
  const { data } = await supabase
    .from("notifications")
    .select("id")
    .eq("user_id", userId)
    .eq("type", "dream_match")
    .eq("related_match_id", matchId)
    .order("created_at", { ascending: false })
    .returns<Array<{ id: string }>>();

  const duplicateIds = (data || []).slice(1).map((item) => item.id).filter(Boolean);
  if (!duplicateIds.length) return;

  await supabase.from("notifications").delete().in("id", duplicateIds).eq("user_id", userId);
}
