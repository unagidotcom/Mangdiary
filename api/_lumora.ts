export type EntryInsight = {
  summary: string;
  reflection: string;
  mood: string;
  themes: string[];
  isDreamLike: boolean;
  imagePrompt: string;
  cards: InsightCard[];
};

export type InsightCard = {
  title: string;
  body: string;
  items?: string[];
};

type DiaryImageDirection = {
  mood: string;
  subject: string;
  setting: string;
  keywords: string[];
  theme: string;
  style: "dreamy" | "cinematic realistic";
  lighting: string;
  palette: string;
  allowFaces: boolean;
  isDream: boolean;
  dreamLogic: string;
};

export type GeneratedMemoryImage = {
  imageUrl: string;
  source: "openai" | "gemini" | "fallback";
  model?: string;
  warning?: string;
};

type ImageProviderKeys = {
  geminiApiKey?: string;
  geminiApiKeys?: string[];
  openAiApiKey?: string;
  openAiApiKeys?: string[];
};

const OPENAI_IMAGE_MODEL = "gpt-image-1";
const GEMINI_IMAGE_MODELS = ["gemini-3.1-flash-image", "gemini-2.5-flash-image"];

export async function analyzeJournalContent(content: string, apiKeys?: string | string[]): Promise<EntryInsight> {
  const keys = normalizeKeyList(apiKeys);
  const isDreamEntry = looksLikeDream(content);
  const prompt = [
    "You are DreamLens inside MangDiary, a gentle journaling and dream analysis assistant. Return strict JSON only.",
    "Fields: summary, reflection, mood, themes, isDreamLike, imagePrompt, cards.",
    "cards must be an array of 1-6 clean insight cards. Each card has title, body, and optional items array.",
    "Use warm natural language. Never diagnose. Keep reflection to one sentence.",
    "Themes must be 2-5 title-case strings. Mood is one short word.",
    "Set isDreamLike true when the entry contains dreams, surreal imagery, imagination, or vivid visual storytelling.",
    isDreamEntry
      ? [
          "This entry appears dream-like. Analyze it through four clearly labeled lenses:",
          "Freudian Lens: manifest/latent content, possible wish, fear, displacement, condensation, or symbolization.",
          "Jungian Lens: archetypes, shadow/self balance, and symbolic personality material.",
          "Cognitive Lens: memory, emotion processing, threat rehearsal, or waking-life continuity.",
          "Activation-Synthesis Lens: what may simply be the brain stitching random signals into story.",
          "Also include Symbol Breakdown, Reflection Questions, and Closing Insight cards when useful.",
          "Use uncertainty language such as 'may suggest' or 'one reading could be'.",
        ].join("\n")
      : "For a non-dream journal entry, create cards for Summary, Emotional Tone, Patterns, and Gentle Next Step when useful.",
    `Journal entry:\n${content}`,
  ].join("\n\n");

  for (const apiKey of keys) {
    try {
      const geminiResponse = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
        },
      );

      if (!geminiResponse.ok) continue;

      const payload = await geminiResponse.json();
      const text = payload?.candidates?.[0]?.content?.parts?.[0]?.text || "";
      const parsed = parseJson(text);
      return normalizeInsight(parsed, content);
    } catch {
      continue;
    }
  }

  return localInsight(content);
}

export async function generateMemoryImageDataUrl(content: string, _prompt: string | undefined, keysOrGeminiKey?: string | ImageProviderKeys) {
  return (await generateMemoryImageResult(content, _prompt, keysOrGeminiKey)).imageUrl;
}

export async function generateMemoryImageResult(
  content: string,
  _prompt: string | undefined,
  keysOrGeminiKey?: string | ImageProviderKeys,
): Promise<GeneratedMemoryImage> {
  const direction = extractDiaryImageDirection(content);
  const keys = normalizeProviderKeys(keysOrGeminiKey);
  const imagePrompt = buildDiaryWallpaperPrompt(direction);
  const errors: string[] = [];

  if (keys.openAiApiKeys.length) {
    for (const apiKey of keys.openAiApiKeys) {
      const result = await requestOpenAIImage(imagePrompt, apiKey);
      if (result.imageUrl) return { imageUrl: result.imageUrl, source: "openai", model: OPENAI_IMAGE_MODEL };
      if (result.error) errors.push(`${OPENAI_IMAGE_MODEL}: ${result.error}`);
    }
  } else {
    errors.push("OPENAI_API_KEY is missing.");
  }

  if (keys.geminiApiKeys.length) {
    for (const apiKey of keys.geminiApiKeys) {
      for (const model of GEMINI_IMAGE_MODELS) {
        const result = await requestGeminiImage(model, imagePrompt, apiKey);
        if (result.imageUrl) return { imageUrl: result.imageUrl, source: "gemini", model };
        if (result.error) errors.push(`${model}: ${result.error}`);
      }
    }
  } else {
    errors.push("GEMINI_API_KEY is missing.");
  }

  const readable = errors[0] || "Gemini image generation did not return an image.";
  if (shouldUseWallpaperFallback(readable)) return fallbackImageResult(content, readable);
  throw new Error(readable);
}

function normalizeProviderKeys(keysOrGeminiKey?: string | ImageProviderKeys): Required<Pick<ImageProviderKeys, "geminiApiKeys" | "openAiApiKeys">> {
  if (!keysOrGeminiKey) return { geminiApiKeys: [], openAiApiKeys: [] };
  if (typeof keysOrGeminiKey === "string") return { geminiApiKeys: normalizeKeyList(keysOrGeminiKey), openAiApiKeys: [] };
  return {
    geminiApiKeys: [...normalizeKeyList(keysOrGeminiKey.geminiApiKey), ...normalizeKeyList(keysOrGeminiKey.geminiApiKeys)],
    openAiApiKeys: [...normalizeKeyList(keysOrGeminiKey.openAiApiKey), ...normalizeKeyList(keysOrGeminiKey.openAiApiKeys)],
  };
}

export function normalizeKeyList(keys?: string | string[]) {
  const rawKeys = Array.isArray(keys) ? keys : keys?.split(/[,\n]+/) || [];
  return Array.from(new Set(rawKeys.map((key) => key.trim()).filter(Boolean)));
}

async function requestOpenAIImage(imagePrompt: string, apiKey: string) {
  const openAiResponse = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: OPENAI_IMAGE_MODEL,
      prompt: imagePrompt,
      size: "1024x1536",
      quality: "medium",
      n: 1,
    }),
  });

  if (!openAiResponse.ok) return { error: readableOpenAIError(await openAiResponse.text()) };

  const payload = await openAiResponse.json();
  const data = payload?.data?.[0]?.b64_json;
  if (!data) return { error: "OpenAI responded but did not include image bytes." };
  return { imageUrl: `data:image/png;base64,${data}` };
}

async function requestGeminiImage(model: string, imagePrompt: string, apiKey: string) {
  const geminiResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: imagePrompt }] }],
      generationConfig: {
        responseModalities: ["TEXT", "IMAGE"],
        imageConfig: {
          aspectRatio: "9:16",
          imageSize: "1K",
        },
      },
    }),
  });

  if (!geminiResponse.ok) return { error: readableGeminiError(await geminiResponse.text()) };

  const payload = await geminiResponse.json();
  const part = payload?.candidates?.[0]?.content?.parts?.find(
    (item: { inlineData?: { data?: string; mimeType?: string }; inline_data?: { data?: string; mime_type?: string } }) =>
      item.inlineData?.data || item.inline_data?.data,
  );
  const generatedImage = payload?.generatedImages?.[0]?.image;
  const data = part?.inlineData?.data || part?.inline_data?.data || generatedImage?.imageBytes;
  const mimeType = part?.inlineData?.mimeType || part?.inline_data?.mime_type || generatedImage?.mimeType || "image/png";

  if (!data) return { error: "Gemini responded but did not include image bytes." };
  return { imageUrl: `data:${mimeType};base64,${data}` };
}

function fallbackImageResult(content: string, reason: string): GeneratedMemoryImage {
  return {
    imageUrl: fallbackMemoryImage(content),
    source: "fallback",
    warning: cleanProviderWarning(reason),
  };
}

function shouldUseWallpaperFallback(message: string) {
  return /\b(quota|billing|paid|unavailable|permission|eligible|exhausted|rate|limit|api key|missing|invalid|incorrect)\b/i.test(message);
}

function cleanProviderWarning(message: string) {
  if (/OPENAI_API_KEY is missing/i.test(message)) {
    return "OpenAI image generation needs OPENAI_API_KEY in .env.local. MangDiary saved a local dream wallpaper until that key is added.";
  }
  if (/OpenAI|incorrect api key|invalid api key/i.test(message)) {
    return "OpenAI image generation could not run with the current API key. MangDiary saved a local dream wallpaper until the key is fixed.";
  }
  if (/billing hard limit/i.test(message)) {
    return "OpenAI image generation is blocked because the account billing hard limit has been reached. MangDiary saved a local dream wallpaper until billing/quota is restored.";
  }
  if (/quota|limit|exhausted|rate/i.test(message)) {
    return "Image generation is blocked by the current provider quota for this key/project. MangDiary saved a local dream wallpaper so the entry still has an image.";
  }
  if (/billing|paid|eligible|permission|unavailable/i.test(message)) {
    return "Image generation is not enabled for this key/project. MangDiary saved a local dream wallpaper so the entry still has an image.";
  }
  return message;
}

function extractDiaryImageDirection(content: string): DiaryImageDirection {
  const lower = content.toLowerCase();
  const isDream = /\b(dream|dreamed|dreamt|nightmare|slept|sleep|woke|surreal|vision|floating|falling|flying)\b/.test(lower);
  const mood = deriveMood(lower);
  const subject = deriveSubject(content, lower);
  const setting = deriveSetting(lower);
  const keywords = deriveKeywords(content);
  const theme = deriveTheme(subject, mood, keywords);
  const style = deriveStyle(lower);
  const lighting = deriveLighting(lower);
  const palette = paletteForMood(mood);
  const allowFaces = mentionsNamedPerson(content);
  const dreamLogic = deriveDreamLogic(lower, keywords);

  return { mood, subject, setting, keywords, theme, style, lighting, palette, allowFaces, isDream, dreamLogic };
}

function buildDiaryWallpaperPrompt(direction: DiaryImageDirection) {
  const scene = [
    `${direction.subject} in ${direction.setting}`,
    `with concrete visual details of ${direction.keywords.join(", ")}`,
    "rendered as an intimate diary memory rather than a generic stock photograph",
  ].join(", ");
  const styleNote =
    direction.style === "dreamy"
      ? "dreamy, emotional, atmospheric, lightly surreal, soft depth of field"
      : "cinematic realistic, grounded, observational, emotionally intense, photographic";
  const dreamNote = direction.isDream
    ? `Dream logic: ${direction.dreamLogic}. Preserve the strange emotional truth of the dream without making it cartoonish.`
    : "Memory logic: keep it natural, intimate, and emotionally precise.";
  const faceConstraint = direction.allowFaces
    ? "Faces may appear only if they are natural, respectful, and central to the named person memory."
    : "No visible faces; use silhouette, hands, back view, reflections, shadows, or environment instead.";

  return [
    `A ${direction.mood}-toned, cinematic ${direction.style} ${direction.isDream ? "dream photograph" : "photograph"}.`,
    scene,
    `The image should feel ${direction.mood.toLowerCase()}, personal, atmospheric, and emotionally specific.`,
    dreamNote,
    `Lighting: ${direction.lighting}.`,
    `Color palette: ${direction.palette}.`,
    `Style: ${styleNote}.`,
    "Composition: Portrait orientation 9:16, phone wallpaper format. Subject upper-center or rule-of-thirds. Lower third breathable and uncluttered for phone icons.",
    "Quality: Ultra high resolution, refined texture, natural film grain, rich but tasteful detail.",
    `Theme: ${direction.theme}.`,
    `Constraints: ${faceConstraint} No text, no captions, no letters, no numbers, no watermark, no logo, no UI elements. Atmospheric over literal.`,
  ].join("\n\n");
}

function deriveMood(lower: string) {
  if (/\b(nightmare|terrified|chased|trapped|screaming|horror|dread)\b/.test(lower)) return "anxious";
  if (/\b(hopeful|happy|joyful|excited|grateful|proud|relieved|inspired|bright)\b/.test(lower)) return "hopeful";
  if (/\b(sad|melancholy|lonely|alone|miss|missing|heavy|empty|hurt|cry|cried)\b/.test(lower)) return "melancholic";
  if (/\b(love|romantic|nostalgic|remember|memory|beautiful|tender|warm)\b/.test(lower)) return "nostalgic";
  if (/\b(anxious|worried|stressed|overwhelmed|panic|afraid|tense|pressure)\b/.test(lower)) return "anxious";
  if (/\b(calm|peaceful|quiet|soft|still|gentle|reflective)\b/.test(lower)) return "peaceful";
  return "reflective";
}

function deriveSubject(content: string, lower: string) {
  const firstSentence = content.trim().split(/[.!?\n]/)[0]?.trim();
  if (/\b(work|office|meeting|deadline|business|project)\b/.test(lower)) return "a private work memory";
  if (/\b(family|mother|father|sister|brother|friend|relationship|partner)\b/.test(lower)) return "a relationship memory";
  if (/\b(dream|slept|sleep|surreal|vision)\b/.test(lower)) return "a dreamlike memory";
  if (/\b(walk|travel|journey|road|train|bus|flight|city)\b/.test(lower)) return "a journey memory";
  if (firstSentence && firstSentence.length > 8) return firstSentence.slice(0, 120);
  return "a quiet private moment";
}

function deriveSetting(lower: string) {
  if (/\b(dream|dreamed|dreamt|nightmare|surreal|vision)\b/.test(lower)) return "a cinematic dreamscape";
  if (/\b(bed|bedroom|room|home|house|kitchen|window)\b/.test(lower)) return "a lived-in room";
  if (/\b(office|desk|meeting|work|screen|laptop)\b/.test(lower)) return "a quiet workspace";
  if (/\b(city|street|traffic|market|station|train|bus)\b/.test(lower)) return "an urban evening street";
  if (/\b(rain|storm|cloud|umbrella|wet)\b/.test(lower)) return "a rain-washed place";
  if (/\b(ocean|sea|river|lake|water|beach)\b/.test(lower)) return "near soft moving water";
  if (/\b(forest|tree|garden|field|mountain|sky)\b/.test(lower)) return "an open natural landscape";
  if (/\b(cafe|coffee|restaurant)\b/.test(lower)) return "a warm cafe corner";
  return "an intimate everyday setting";
}

function deriveKeywords(content: string) {
  const stopWords = new Set([
    "about",
    "after",
    "again",
    "because",
    "before",
    "being",
    "could",
    "entry",
    "every",
    "feeling",
    "from",
    "have",
    "journal",
    "know",
    "like",
    "more",
    "note",
    "only",
    "really",
    "should",
    "that",
    "there",
    "this",
    "today",
    "where",
    "while",
    "with",
    "would",
  ]);
  const words = content
    .toLowerCase()
    .match(/[a-z][a-z'-]{3,}/g)
    ?.map((word) => word.replace(/^'+|'+$/g, ""))
    .filter((word) => !stopWords.has(word)) || [];
  const unique = Array.from(new Set(words)).slice(0, 8);
  return unique.length >= 5 ? unique : [...unique, "soft light", "quiet space", "memory", "shadow", "air"].slice(0, 8);
}

function deriveTheme(subject: string, mood: string, keywords: string[]) {
  return `A ${mood} diary memory about ${subject}, shaped by ${keywords.slice(0, 3).join(", ")}.`;
}

function deriveStyle(lower: string): DiaryImageDirection["style"] {
  if (/\b(dream|dreamed|dreamt|nightmare|memory|remember|miss|love|soft|quiet|gentle|nostalgic|tender|surreal|floating|flying)\b/.test(lower)) return "dreamy";
  if (/\b(event|crowd|travel|fight|argument|deadline|meeting|intense|rush|street|city)\b/.test(lower)) return "cinematic realistic";
  return "dreamy";
}

function deriveLighting(lower: string) {
  if (/\b(dream|dreamed|dreamt|surreal|vision)\b/.test(lower)) return "unreal cinematic light, soft glow, and shadow edges that feel remembered";
  if (/\b(nightmare|terrified|chased|trapped)\b/.test(lower)) return "low-key moonlit contrast with tense shadows and a faint practical glow";
  if (/\b(morning|sunrise|dawn)\b/.test(lower)) return "soft morning light with warm highlights";
  if (/\b(noon|midday|afternoon)\b/.test(lower)) return "clean bright daylight with gentle contrast";
  if (/\b(evening|sunset|golden hour)\b/.test(lower)) return "golden hour side light with long soft shadows";
  if (/\b(night|late|moon|dark)\b/.test(lower)) return "night glow, blue-hour shadows, and small warm practical lights";
  if (/\b(rain|cloud|storm|overcast)\b/.test(lower)) return "diffused overcast light reflected on wet surfaces";
  if (/\b(office|hospital|clinic|screen)\b/.test(lower)) return "cool clinical light softened by ambient shadows";
  return "diffused natural light with a quiet cinematic falloff";
}

function paletteForMood(mood: string) {
  switch (mood) {
    case "hopeful":
      return "warm golds, soft greens, and sky blues";
    case "melancholic":
      return "muted blues, grays, and cool shadows";
    case "nostalgic":
      return "amber, dusty rose, film-grain warmth, and gentle haze";
    case "anxious":
      return "high contrast, stark shadows, and cool clinical whites";
    case "peaceful":
      return "soft pastels, diffused light, and gentle blur";
    default:
      return "warm neutrals, softened contrast, and a restrained emotional accent color";
  }
}

function mentionsNamedPerson(content: string) {
  return /\b(?:with|about|miss|missing|love|met|saw|called|texted)\s+[A-Z][a-z]{2,}\b/.test(content);
}

function deriveDreamLogic(lower: string, keywords: string[]) {
  const motions = [
    /\b(flying|float|floating)\b/.test(lower) ? "weightless movement" : "",
    /\b(falling|drop|sinking)\b/.test(lower) ? "a slow falling sensation" : "",
    /\b(chased|running|escape)\b/.test(lower) ? "urgent motion and hidden threat" : "",
    /\b(lost|maze|unknown)\b/.test(lower) ? "disorientation and impossible space" : "",
    /\b(water|ocean|river|rain)\b/.test(lower) ? "water reflections and blurred boundaries" : "",
    /\b(door|room|house|window)\b/.test(lower) ? "familiar rooms becoming unfamiliar" : "",
  ].filter(Boolean);

  if (motions.length) return motions.slice(0, 3).join(", ");
  return `symbolic fragments of ${keywords.slice(0, 4).join(", ")}`;
}

function fallbackMemoryImage(content: string) {
  const direction = extractDiaryImageDirection(content);
  const seed = Array.from(content).reduce((sum, char) => sum + char.charCodeAt(0), 0);
  const hueA = seed % 360;
  const hueB = moodHue(direction.mood, hueA);
  const hueC = (hueB + 168) % 360;
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920" viewBox="0 0 1080 1920">
      <defs>
        <linearGradient id="bg" x1="0.18" x2="0.86" y1="0" y2="1">
          <stop offset="0" stop-color="hsl(${hueA}, 46%, 22%)"/>
          <stop offset="0.48" stop-color="hsl(${hueB}, 42%, 38%)"/>
          <stop offset="1" stop-color="hsl(${hueC}, 34%, 16%)"/>
        </linearGradient>
        <radialGradient id="glow" cx="45%" cy="18%" r="52%">
          <stop offset="0" stop-color="rgba(255,255,255,0.34)"/>
          <stop offset="0.58" stop-color="rgba(255,255,255,0.07)"/>
          <stop offset="1" stop-color="rgba(255,255,255,0)"/>
        </radialGradient>
        <filter id="soft"><feGaussianBlur stdDeviation="38"/></filter>
        <filter id="grain">
          <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="3" stitchTiles="stitch"/>
          <feColorMatrix type="saturate" values="0"/>
          <feComponentTransfer><feFuncA type="table" tableValues="0 0.14"/></feComponentTransfer>
        </filter>
      </defs>
      <rect width="1080" height="1920" fill="url(#bg)"/>
      <rect width="1080" height="1920" fill="url(#glow)"/>
      <circle cx="280" cy="270" r="180" fill="rgba(255,238,211,0.22)" filter="url(#soft)"/>
      <circle cx="840" cy="760" r="320" fill="rgba(255,255,255,0.13)" filter="url(#soft)"/>
      ${fallbackScene(direction)}
      <g opacity="0.56">
        <path d="M310 470 C 440 350, 620 355, 735 490 C 660 560, 515 590, 390 555 C 352 545, 324 520, 310 470Z" fill="rgba(255,255,255,0.16)"/>
        <path d="M445 535 C 520 490, 620 505, 690 555" fill="none" stroke="rgba(255,255,255,0.24)" stroke-width="4" stroke-linecap="round"/>
      </g>
      <rect y="1180" width="1080" height="740" fill="rgba(0,0,0,0.14)"/>
      <rect width="1080" height="1920" filter="url(#grain)" opacity="0.55"/>
    </svg>
  `;

  return `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
}

function fallbackScene(direction: DiaryImageDirection) {
  if (direction.isDream) {
    return `
      <path d="M80 780 C 250 610, 415 735, 520 620 S 775 430, 1000 590" fill="none" stroke="rgba(255,255,255,0.34)" stroke-width="7" stroke-linecap="round"/>
      <path d="M166 1030 C 330 890, 420 990, 560 900 S 810 760, 982 890" fill="none" stroke="rgba(255,255,255,0.2)" stroke-width="4" stroke-linecap="round"/>
      <path d="M502 665 C 550 625, 615 625, 660 668 C 615 718, 548 720, 502 665Z" fill="rgba(255,255,255,0.18)"/>
      <circle cx="730" cy="390" r="62" fill="rgba(255,255,255,0.2)"/>
      <path d="M230 1210 C 400 1130, 660 1130, 850 1220 L1080 1920 L0 1920Z" fill="rgba(0,0,0,0.18)"/>
    `;
  }

  if (/water|rain|ocean|river|lake|wet/i.test(direction.setting + direction.keywords.join(" "))) {
    return `
      <path d="M100 820 C 250 680, 390 790, 510 700 S 760 540, 970 690" fill="none" stroke="rgba(255,255,255,0.32)" stroke-width="7" stroke-linecap="round"/>
      <path d="M120 910 C 290 780, 410 925, 560 835 S 800 720, 980 850" fill="none" stroke="rgba(255,255,255,0.18)" stroke-width="3" stroke-linecap="round"/>
      <path d="M0 1250 C 220 1190, 420 1305, 640 1240 S 920 1160, 1080 1235 L1080 1920 L0 1920Z" fill="rgba(0,0,0,0.16)"/>
    `;
  }

  return `
    <path d="M100 820 C 250 680, 390 790, 510 700 S 760 540, 970 690" fill="none" stroke="rgba(255,255,255,0.32)" stroke-width="7" stroke-linecap="round"/>
    <path d="M120 910 C 290 780, 410 925, 560 835 S 800 720, 980 850" fill="none" stroke="rgba(255,255,255,0.18)" stroke-width="3" stroke-linecap="round"/>
    <path d="M250 1120 L835 1120 L930 1920 L120 1920Z" fill="rgba(0,0,0,0.14)"/>
  `;
}

function moodHue(mood: string, fallback: number) {
  switch (mood) {
    case "hopeful":
      return 48;
    case "melancholic":
      return 212;
    case "nostalgic":
      return 24;
    case "anxious":
      return 205;
    case "peaceful":
      return 156;
    default:
      return fallback;
  }
}

function readableGeminiError(errorText: string) {
  try {
    const parsed = JSON.parse(errorText);
    const message = String(parsed?.error?.message || "");
    if (parsed?.error?.status === "RESOURCE_EXHAUSTED" || message.toLowerCase().includes("quota")) {
      return "Gemini image generation quota is exhausted for this API key. Check Google AI Studio billing or quota for the Gemini image model.";
    }
    return message || "Image generation failed.";
  } catch {
    return errorText || "Image generation failed.";
  }
}

function readableOpenAIError(errorText: string) {
  try {
    const parsed = JSON.parse(errorText);
    const message = String(parsed?.error?.message || "");
    const code = String(parsed?.error?.code || "");
    return message || code || "OpenAI image generation failed.";
  } catch {
    return errorText || "OpenAI image generation failed.";
  }
}

export function localInsight(content: string): EntryInsight {
  const lower = content.toLowerCase();
  const mood = lower.match(/\b(anxious|worried|stressed|afraid|overwhelmed)\b/)
    ? "Anxious"
    : lower.match(/\b(excited|happy|hopeful|energized|inspired)\b/)
      ? "Hopeful"
      : lower.match(/\b(calm|peaceful|quiet|soft)\b/)
        ? "Peaceful"
        : "Reflective";
  const themes = [
    lower.includes("work") || lower.includes("business") ? "Business" : "",
    lower.includes("family") || lower.includes("friend") || lower.includes("relationship") ? "Relationships" : "",
    lower.includes("dream") || lower.includes("imagined") || lower.includes("surreal") ? "Dreams" : "",
    lower.includes("learn") || lower.includes("grow") || lower.includes("goal") ? "Growth" : "",
    lower.includes("create") || lower.includes("art") || lower.includes("write") ? "Creativity" : "",
    lower.includes("travel") || lower.includes("journey") ? "Travel" : "",
  ].filter(Boolean);

  const isDreamLike = looksLikeDream(content);
  const summary = content.trim().split(/[.!?]/)[0].slice(0, 160);
  const reflection = `You seem to be moving through the day with a ${mood.toLowerCase()} tone.`;
  const cards = isDreamLike ? localDreamCards(content, mood, themes) : localJournalCards(summary, mood, themes);

  return {
    summary,
    reflection,
    mood,
    themes: themes.length ? themes : ["Reflection"],
    isDreamLike,
    imagePrompt: `A beautiful memory-like visualization inspired by this journal entry: ${content.slice(0, 900)}`,
    cards,
  };
}

function parseJson(text: string) {
  try {
    const cleaned = text.replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

function normalizeInsight(value: unknown, content: string): EntryInsight {
  if (!value || typeof value !== "object") return localInsight(content);
  const candidate = value as Partial<EntryInsight>;
  const fallback = localInsight(content);

  return {
    summary: trimText(candidate.summary || fallback.summary, 220),
    reflection: trimText(candidate.reflection || fallback.reflection, 320),
    mood: trimText(candidate.mood || fallback.mood, 40),
    themes: Array.isArray(candidate.themes) ? candidate.themes.map(String).slice(0, 5) : fallback.themes,
    isDreamLike: Boolean(candidate.isDreamLike ?? fallback.isDreamLike),
    imagePrompt: trimText(candidate.imagePrompt || fallback.imagePrompt, 1200),
    cards: normalizeCards((candidate as Partial<EntryInsight>).cards, fallback.cards),
  };
}

function normalizeCards(value: unknown, fallback: InsightCard[]) {
  if (!Array.isArray(value)) return fallback;
  const cards = value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const candidate = item as Partial<InsightCard>;
      const title = trimText(candidate.title || "", 80);
      const body = trimText(candidate.body || "", 760);
      const items = Array.isArray(candidate.items)
        ? candidate.items.map((entry) => trimText(String(entry).replace(/\*\*/g, ""), 180)).filter(Boolean).slice(0, 5)
        : undefined;
      if (!title || !body) return null;
      return { title, body, ...(items?.length ? { items } : {}) };
    })
    .filter((item): item is InsightCard => Boolean(item))
    .slice(0, 6);
  return cards.length ? cards : fallback;
}

function trimText(value: unknown, limit: number) {
  const text = String(value || "").trim();
  if (text.length <= limit) return text;
  const clipped = text.slice(0, limit).replace(/\s+\S*$/, "").trim();
  return `${clipped || text.slice(0, limit).trim()}...`;
}

function looksLikeDream(content: string) {
  return /\b(dream|dreamed|dreamt|nightmare|slept|sleep|woke|surreal|imagined|floating|falling|flying|vision)\b/i.test(content);
}

function localJournalCards(summary: string, mood: string, themes: string[]): InsightCard[] {
  return [
    {
      title: "Entry Summary",
      body: summary || "This entry is beginning to form a private record of the day.",
    },
    {
      title: "Emotional Tone",
      body: `The writing carries a ${mood.toLowerCase()} tone, with attention moving through ${themes.length ? themes.slice(0, 3).join(", ") : "reflection"}.`,
    },
  ];
}

function localDreamCards(content: string, mood: string, themes: string[]): InsightCard[] {
  const symbols = deriveKeywords(content).slice(0, 5);
  return [
    {
      title: "Dream Summary",
      body: content.trim().split(/[.!?\n]/).filter(Boolean).slice(0, 2).join(". ").slice(0, 260) || "The dream has a symbolic, emotionally charged quality.",
    },
    {
      title: "Symbol Breakdown",
      body: "These images may be carrying the dream's emotional weight.",
      items: symbols,
    },
    {
      title: "Freudian Lens",
      body: "One reading could be that the dream is disguising a desire, fear, or unresolved tension behind symbolic images rather than stating it directly.",
    },
    {
      title: "Jungian Lens",
      body: `From a Jungian angle, the dream may be asking for balance around ${themes.length ? themes[0].toLowerCase() : "a hidden part of the self"}.`,
    },
    {
      title: "Cognitive Lens",
      body: `The ${mood.toLowerCase()} tone may reflect your mind processing recent emotion, memory, or unfinished concerns during sleep.`,
    },
    {
      title: "Activation-Synthesis Lens",
      body: "Some strange details may be random neural material, but the story your mind built from them can still reveal what feels emotionally important.",
    },
  ];
}
