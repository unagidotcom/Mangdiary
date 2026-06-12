import { Session, User } from "@supabase/supabase-js";
import {
  BookOpen,
  Check,
  Cloud,
  Download,
  Image,
  LogOut,
  Mic,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Search,
  Sparkles,
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSpeechRecognition } from "./hooks/useSpeechRecognition";
import { dateMonthsAgo, dateYearsAgo, greeting, isoToday, longDate, themeForTime } from "./lib/date";
import { hasSupabaseConfig, supabase } from "./lib/supabase";
import type { AppIssue, EntryInsight, InsightCard, JournalEntry, SaveState } from "./types";

const emptyInsight: EntryInsight = {
  summary: "",
  reflection: "",
  mood: "",
  themes: [],
  isDreamLike: false,
  imagePrompt: "",
  cards: [],
};

const draftKeyFor = (entryId: string) => `lumora-draft-${entryId}`;
const welcomeSeenKey = "mangdiary-welcome-seen";

export function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [booting, setBooting] = useState(true);
  const [welcomeSeen, setWelcomeSeen] = useState(() => sessionStorage.getItem(welcomeSeenKey) === "true");

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setBooting(false);
    });

    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setBooting(false);
    });

    return () => data.subscription.unsubscribe();
  }, []);

  function dismissWelcome() {
    sessionStorage.setItem(welcomeSeenKey, "true");
    setWelcomeSeen(true);
  }

  if (booting) return <Splash />;
  if (!hasSupabaseConfig) return import.meta.env.DEV ? <LocalPreviewApp /> : <MissingConfig />;
  if (!session) return <AuthScreen onStartedSignIn={dismissWelcome} />;
  if (!welcomeSeen) return <WelcomeScreen user={session.user} onContinue={dismissWelcome} />;
  return <JournalApp user={session.user} />;
}

function Splash() {
  return (
    <main className="app-shell theme-morning">
      <div className="centered">
        <BookOpen size={30} />
      </div>
    </main>
  );
}

function MissingConfig() {
  return (
    <main className="app-shell theme-morning">
      <section className="auth-panel">
        <BookOpen />
        <h1>MangDiary</h1>
        <p>Add your Supabase environment values in `.env.local` to open the journal.</p>
      </section>
    </main>
  );
}

function LocalPreviewApp() {
  const today = isoToday();
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const [autoTheme, setAutoTheme] = useState(themeForTime());
  const theme = autoTheme;
  const [content, setContent] = useState(() => localStorage.getItem(`lumora-preview-${today}`) || "");
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [insight, setInsight] = useState<EntryInsight>(emptyInsight);
  const [timelineOpen, setTimelineOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [entryFilter, setEntryFilter] = useState<EntryFilter>("daily");

  useEffect(() => {
    document.body.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    const timer = window.setInterval(() => setAutoTheme(themeForTime()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const focusTimer = window.setTimeout(() => editorRef.current?.focus(), 150);
    return () => window.clearTimeout(focusTimer);
  }, []);

  useEffect(() => {
    setSaveState("saving");
    const timer = window.setTimeout(() => {
      localStorage.setItem(`lumora-preview-${today}`, content);
      setSaveState("saved");
    }, 800);
    return () => window.clearTimeout(timer);
  }, [content, today]);

  useEffect(() => {
    if (content.trim().length < 120) {
      setInsight(emptyInsight);
      return;
    }
    const local = localPreviewInsight(content);
    setInsight(local);
  }, [content]);

  const speech = useSpeechRecognition((text) => {
    setContent((current) => `${current}${current.endsWith(" ") || current.length === 0 ? "" : " "}${text}`);
  });

  const previewEntries = useMemo(
    () => [
      {
        date: today,
        title: "Today",
        summary: content.trim() || "Today's page is ready.",
      },
    ],
    [content, today],
  );

  const filteredPreviewEntries = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return previewEntries.filter((item) => {
      const matchesSearch = !needle || `${item.title} ${item.summary}`.toLowerCase().includes(needle);
      return matchesSearch && isEntryInFilter(item.date, entryFilter);
    });
  }, [entryFilter, previewEntries, query]);

  function runPreviewInsight() {
    setInsight(localPreviewInsight(content));
    document.querySelector(".reflection")?.scrollIntoView({ behavior: "smooth", block: "start" });
    setTimelineOpen(false);
  }

  return (
    <main className={`app-shell theme-${theme}`}>
      <div className="paper-grain" />
      <header className="top-bar preview-top-bar">
        <button className="icon-button menu-button" type="button" onClick={() => setTimelineOpen((open) => !open)} aria-label="Menu">
          {timelineOpen ? <PanelLeftClose /> : <PanelLeftOpen />}
          <span>Menu</span>
        </button>
        <span className="config-note">Add `.env.local` for Supabase</span>
      </header>
      <div className="journal-layout preview-layout">
        <AnimatePresence>
          {timelineOpen ? (
            <motion.aside
              className="timeline"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <div className="timeline-head">
                <h2 className="timeline-title">Menu</h2>
                <span>{theme}</span>
              </div>
              <div className="menu-actions">
                <button type="button" onClick={() => setTimelineOpen(false)}>Today</button>
                <button type="button" onClick={runPreviewInsight}>AI Insights</button>
              </div>
              <EntryFilterTabs value={entryFilter} onChange={setEntryFilter} />
              <div className="search-box">
                <Search size={16} />
                <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search memories" />
              </div>
              <div className="timeline-list">
                {filteredPreviewEntries.map((item) => (
                  <button className="timeline-item active" key={item.date} type="button" onClick={() => setTimelineOpen(false)}>
                    <Cloud className="timeline-cloud" size={18} />
                    <span>{item.title}</span>
                    <small>{item.summary}</small>
                  </button>
                ))}
              </div>
              <p className="timeline-empty">Older entries appear here after Supabase is connected.</p>
            </motion.aside>
          ) : null}
        </AnimatePresence>
        <section className="journal-page preview-page">
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="entry-heading">
            <h1>{greeting()}</h1>
            <time>{longDate(today)}</time>
          </motion.div>
          <textarea
            ref={editorRef}
            value={content}
            onChange={(event) => setContent(event.target.value)}
            placeholder="How are you feeling today?"
            className="journal-editor"
            aria-label="Journal entry"
          />
          {speech.transcript ? <div className="live-transcript">{speech.transcript}</div> : null}
          <footer className="entry-actions">
            <button
              className={speech.isListening ? "voice-button listening" : "voice-button"}
              type="button"
              onClick={speech.isListening ? speech.stop : speech.start}
              disabled={!speech.supported}
              aria-label={speech.isListening ? "Stop dictation" : "Start dictation"}
            >
              <Mic />
            </button>
            <SaveStatus state={saveState} />
          </footer>
          <ReflectionPanel insight={insight} state="idle" error="" onReflect={() => setInsight(localPreviewInsight(content))} />
        </section>
      </div>
    </main>
  );
}

function AuthScreen({ onStartedSignIn }: { onStartedSignIn: () => void }) {
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function signInWithGoogle() {
    setLoading(true);
    setError("");
    onStartedSignIn();
    const { error: authError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin },
    });
    if (authError) {
      setLoading(false);
      setError(authError.message);
    }
  }

  return (
    <main className="app-shell theme-morning welcome-shell">
      <WelcomeBackdrop />
      <motion.section
        className="auth-panel welcome-panel"
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45 }}
      >
        <div className="welcome-mark">
          <BookOpen className="brand-mark" />
          <Sparkles />
        </div>
        <span className="welcome-kicker">Private AI journal</span>
        <h1>MangDiary</h1>
        <p>Store your dreams, capture daily memories, and let AI turn each entry into gentle insight you can revisit over time.</p>
        <div className="welcome-value-grid" aria-label="MangDiary features">
          <WelcomeValue icon={<Moon />} title="Dream Library" body="Save dreams the moment you wake and keep them in your private account." />
          <WelcomeValue icon={<Sparkles />} title="Daily Analysis" body="Generate clean AI insight cards for dreams, moods, symbols, and themes." />
          <WelcomeValue icon={<BookOpen />} title="Pattern Memory" body="Look back across days, weeks, and months to notice what keeps returning." />
        </div>
        <div className="welcome-actions">
          <button className="google-button" type="button" onClick={signInWithGoogle} disabled={loading}>
            <span className="google-g">G</span>
            {loading ? "Opening Google..." : "Continue with Google"}
          </button>
          {error ? <span className="form-error">{error}</span> : null}
        </div>
        <small>Your entries are saved under your authenticated Supabase user ID.</small>
      </motion.section>
    </main>
  );
}

function WelcomeScreen({ user, onContinue }: { user: User; onContinue: () => void }) {
  return (
    <main className="app-shell theme-morning welcome-shell">
      <WelcomeBackdrop />
      <motion.section
        className="auth-panel welcome-panel"
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45 }}
      >
        <div className="welcome-mark">
          <BookOpen className="brand-mark" />
          <Sparkles />
        </div>
        <span className="welcome-kicker">Welcome back</span>
        <h1>MangDiary</h1>
        <p>Your private dream and diary space is ready. Open it to write, analyze, and revisit your inner patterns.</p>
        <div className="welcome-value-grid" aria-label="MangDiary features">
          <WelcomeValue icon={<Moon />} title="Dream Library" body="Your saved dreams stay connected to your own account." />
          <WelcomeValue icon={<Sparkles />} title="Daily Analysis" body="Reflect on today's entry with AI insight cards." />
          <WelcomeValue icon={<BookOpen />} title="Pattern Memory" body="Review weekly and monthly themes as your diary grows." />
        </div>
        <div className="welcome-actions">
          <button className="google-button" type="button" onClick={onContinue}>
            Open diary
          </button>
        </div>
        <small>{user.email ? `Signed in as ${user.email}` : "Signed in with Google"}</small>
      </motion.section>
    </main>
  );
}

function WelcomeBackdrop() {
  return (
    <div className="welcome-backdrop" aria-hidden="true">
      <span />
      <span />
      <span />
    </div>
  );
}

function WelcomeValue({ icon, title, body }: { icon: JSX.Element; title: string; body: string }) {
  return (
    <article className="welcome-value">
      {icon}
      <div>
        <h2>{title}</h2>
        <p>{body}</p>
      </div>
    </article>
  );
}

function JournalApp({ user }: { user: User }) {
  const today = isoToday();
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const saveTimerRef = useRef<number | null>(null);
  const analysisTimerRef = useRef<number | null>(null);
  const lastAnalyzedRef = useRef("");
  const accessTokenRef = useRef("");
  const [autoTheme, setAutoTheme] = useState(themeForTime());
  const theme = autoTheme;
  const [entry, setEntry] = useState<JournalEntry | null>(null);
  const [content, setContent] = useState("");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [query, setQuery] = useState("");
  const [entryFilter, setEntryFilter] = useState<EntryFilter>("daily");
  const [timelineOpen, setTimelineOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState(today);
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);
  const [insight, setInsight] = useState<EntryInsight>(emptyInsight);
  const [memory, setMemory] = useState<JournalEntry | null>(null);
  const [weekly, setWeekly] = useState("");
  const [monthly, setMonthly] = useState("");
  const [imageState, setImageState] = useState<"idle" | "generating" | "warning" | "error">("idle");
  const [imageError, setImageError] = useState("");
  const [insightState, setInsightState] = useState<"idle" | "reflecting" | "error">("idle");
  const [insightError, setInsightError] = useState("");
  const [issue, setIssue] = useState<AppIssue | null>(null);

  useEffect(() => {
    const timer = window.setInterval(() => setAutoTheme(themeForTime()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    document.body.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      accessTokenRef.current = data.session?.access_token || "";
    });

    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      accessTokenRef.current = nextSession?.access_token || "";
    });

    return () => data.subscription.unsubscribe();
  }, []);

  const loadEntries = useCallback(async () => {
    const { data, error } = await supabase
      .from("journal_entries")
      .select("*")
      .eq("user_id", user.id)
      .order("entry_date", { ascending: false })
      .order("created_at", { ascending: false })
      .order("entry_index", { ascending: false })
      .limit(50);
    if (error) {
      setIssue(databaseIssue(error.message));
      setEntries([]);
      return;
    }
    setEntries((data as JournalEntry[]) || []);
  }, [user.id]);

  const applyEntry = useCallback((nextEntry: JournalEntry) => {
    const draft = localStorage.getItem(draftKeyFor(nextEntry.id));
    setEntry(nextEntry);
    setSelectedEntryId(nextEntry.id);
    setSelectedDate(nextEntry.entry_date);
    setContent(draft ?? nextEntry.content ?? "");
    setInsight({
      summary: nextEntry.summary || "",
      reflection: nextEntry.reflection || "",
      mood: nextEntry.mood || "",
      themes: nextEntry.themes || [],
      isDreamLike: false,
      imagePrompt: nextEntry.image_prompt || "",
      cards: buildStoredInsightCards(nextEntry),
    });
    setIssue(null);
  }, []);

  const loadEntryForDate = useCallback(
    async (entryDate: string) => {
      const { data, error } = await supabase
        .from("journal_entries")
        .select("*")
        .eq("user_id", user.id)
        .eq("entry_date", entryDate)
        .order("entry_index", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        setIssue(databaseIssue(error.message));
        setSaveState("error");
        return;
      }
      if (data) {
        applyEntry(data as JournalEntry);
        return;
      }

      const { data: created, error: createError } = await supabase
        .from("journal_entries")
        .insert({ user_id: user.id, entry_date: entryDate, entry_index: await nextEntryIndex(entryDate), content: "" })
        .select("*")
        .single();

      if (createError) {
        setIssue(databaseIssue(createError.message));
        setSaveState("error");
        return;
      }

      if (created) {
        const createdEntry = created as JournalEntry;
        localStorage.removeItem(draftKeyFor(createdEntry.id));
        applyEntry(createdEntry);
        setIssue(null);
        await loadEntries();
      }
    },
    [applyEntry, loadEntries, user.id],
  );

  useEffect(() => {
    loadEntryForDate(selectedDate);
  }, [loadEntryForDate, selectedDate]);

  useEffect(() => {
    loadEntries();
  }, [loadEntries]);

  useEffect(() => {
    if (selectedDate === today) {
      const timer = window.setTimeout(() => editorRef.current?.focus(), 150);
      return () => window.clearTimeout(timer);
    }
  }, [selectedDate, today]);

  useEffect(() => {
    const targetDates = [dateYearsAgo(1), dateMonthsAgo(6)];
    const found = entries.find((item) => targetDates.includes(item.entry_date) && item.content.trim().length > 0);
    setMemory(found || null);
  }, [entries]);

  const persist = useCallback(
    async (nextContent = content, quiet = false) => {
      if (!entry) {
        setSaveState("error");
        setIssue({
          title: "Entry is not ready",
          detail: "MangDiary could not open today's database entry yet, so there is nothing to save. Run the Supabase schema if this keeps happening.",
        });
        return;
      }
      if (!quiet) setSaveState("saving");
      localStorage.setItem(draftKeyFor(entry.id), nextContent);
      const { data, error } = await supabase
        .from("journal_entries")
        .update({ content: nextContent, updated_at: new Date().toISOString() })
        .eq("id", entry.id)
        .eq("user_id", user.id)
        .select("*")
        .single();

      if (error) {
        setSaveState("error");
        setIssue(databaseIssue(error.message));
        return;
      }

      setEntry(data as JournalEntry);
      setSaveState("saved");
      setIssue(null);
      localStorage.removeItem(draftKeyFor(entry.id));
      await loadEntries();
    },
    [content, entry, loadEntries, user.id],
  );

  useEffect(() => {
    if (!entry) return;
    if (content === entry.content) {
      localStorage.removeItem(draftKeyFor(entry.id));
      setSaveState("saved");
      return;
    }
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    setSaveState("saving");
    localStorage.setItem(draftKeyFor(entry.id), content);
    saveTimerRef.current = window.setTimeout(() => persist(content), 1200);
    return () => {
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    };
  }, [content, entry, persist]);

  useEffect(() => {
    const flush = () => {
      if (entry && content !== entry.content) {
        localStorage.setItem(draftKeyFor(entry.id), content);
        navigator.sendBeacon?.(
          "/api/beacon-save",
          JSON.stringify({ id: entry.id, userId: user.id, content, accessToken: accessTokenRef.current }),
        );
      }
    };
    window.addEventListener("beforeunload", flush);
    return () => window.removeEventListener("beforeunload", flush);
  }, [content, entry, user.id]);

  useEffect(() => {
    if (!entry || content.trim().length < 160 || content === lastAnalyzedRef.current) return;
    if (analysisTimerRef.current) window.clearTimeout(analysisTimerRef.current);
    analysisTimerRef.current = window.setTimeout(async () => {
      await refreshInsight(false);
    }, 2800);
  }, [content, entry]);

  useEffect(() => {
    if (entries.length === 0) return;
    setWeekly(buildPeriodReflection(entries.slice(0, 7), "week"));
    setMonthly(buildPeriodReflection(entries.slice(0, 31), "month"));
  }, [entries]);

  const insertSpeech = useCallback((text: string) => {
    setContent((current) => `${current}${current.endsWith(" ") || current.length === 0 ? "" : " "}${text}`);
  }, []);

  const speech = useSpeechRecognition(insertSpeech);

  const filteredEntries = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return entries.filter((item) => {
      const matchesSearch =
        !needle || [item.content, item.summary || "", item.mood || "", ...(item.themes || [])].join(" ").toLowerCase().includes(needle);
      return matchesSearch && isEntryInFilter(item.entry_date, entryFilter);
    });
  }, [entries, entryFilter, query]);

  const canGenerateMemoryImage = content.trim().length >= 40;

  async function nextEntryIndex(entryDate: string) {
    const sameDayEntries = entries.filter((item) => item.entry_date === entryDate);
    if (sameDayEntries.length > 0) return Math.max(...sameDayEntries.map((item) => item.entry_index || 1)) + 1;

    const { data } = await supabase
      .from("journal_entries")
      .select("entry_index")
      .eq("user_id", user.id)
      .eq("entry_date", entryDate)
      .order("entry_index", { ascending: false })
      .limit(1);

    const latest = data?.[0] as Pick<JournalEntry, "entry_index"> | undefined;
    return (latest?.entry_index || 0) + 1;
  }

  async function refreshInsight(manual: boolean) {
    if (!entry || content.trim().length < 40) {
      if (manual) {
        setInsightState("error");
        setInsightError("Write a little more before generating a reflection.");
      }
      return;
    }

    setInsightState("reflecting");
    setInsightError("");

    try {
      const nextInsight = await analyzeEntry(content);
      if (!nextInsight) throw new Error("Reflection could not be generated.");
      lastAnalyzedRef.current = content;
      setInsight(nextInsight);
      const { data, error } = await supabase
        .from("journal_entries")
        .update({
          summary: nextInsight.summary,
          reflection: nextInsight.reflection,
          mood: nextInsight.mood,
          themes: nextInsight.themes,
          image_prompt: nextInsight.imagePrompt,
        })
        .eq("id", entry.id)
        .eq("user_id", user.id)
        .select("*")
        .single();
      if (error) throw error;
      if (data) {
        setEntry(data as JournalEntry);
        setIssue(null);
      }
      await loadEntries();
      setInsightState("idle");
    } catch (error) {
      setInsightState("error");
      setInsightError(error instanceof Error ? error.message : "Reflection could not be generated.");
    }
  }

  function scrollTo(selector: string) {
    document.querySelector(selector)?.scrollIntoView({ behavior: "smooth", block: "start" });
    setTimelineOpen(false);
  }

  function runAiInsights() {
    scrollTo(".reflection");
    void refreshInsight(true);
  }

  async function createNewEntry() {
    if (entry && content !== entry.content) await persist(content, true);
    setSaveState("saving");
    const { data, error } = await supabase
      .from("journal_entries")
      .insert({ user_id: user.id, entry_date: today, entry_index: await nextEntryIndex(today), content: "" })
      .select("*")
      .single();

    if (error) {
      setSaveState("error");
      setIssue(databaseIssue(error.message));
      return;
    }

    const nextEntry = data as JournalEntry;
    applyEntry(nextEntry);
    setSaveState("saved");
    setTimelineOpen(false);
    await loadEntries();
    window.setTimeout(() => editorRef.current?.focus(), 100);
  }

  async function generateMemoryImage() {
    if (!entry || !content.trim()) return;
    setImageState("generating");
    setImageError("");

    try {
      const response = await fetch("/api/generate-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, prompt: insight.imagePrompt }),
      });
      const result = (await response.json()) as { imageUrl?: string; error?: string; source?: "gemini" | "fallback"; warning?: string };
      if (!response.ok || !result.imageUrl) throw new Error(result.error || "Image generation failed.");

      const { data, error } = await supabase
        .from("journal_entries")
        .update({ image_url: result.imageUrl })
        .eq("id", entry.id)
        .eq("user_id", user.id)
        .select("*")
        .single();
      if (error) throw error;
      if (data) setEntry(data as JournalEntry);
      await loadEntries();
      if (result.source === "fallback" && result.warning) {
        setImageState("warning");
        setImageError(result.warning);
      } else {
        setImageState("idle");
      }
    } catch (error) {
      setImageState("error");
      setImageError(error instanceof Error ? error.message : "Image generation failed.");
    }
  }

  function downloadMemoryImage() {
    if (!entry?.image_url) return;
    const link = document.createElement("a");
    link.href = entry.image_url;
    link.download = `mangdiary-memory-${entry.entry_date}.${imageExtension(entry.image_url)}`;
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  return (
    <main className={`app-shell theme-${theme}`}>
      <div className="paper-grain" />
      <header className="top-bar">
        <button className="icon-button menu-button" type="button" onClick={() => setTimelineOpen((open) => !open)} aria-label="Menu">
          {timelineOpen ? <PanelLeftClose /> : <PanelLeftOpen />}
          <span>Menu</span>
        </button>
        <button className="icon-button" type="button" onClick={() => supabase.auth.signOut()} aria-label="Sign out">
          <LogOut />
        </button>
      </header>

      <div className="journal-layout">
        <AnimatePresence>
          {timelineOpen ? (
            <motion.aside
              className="timeline"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <div className="timeline-head">
                <h2 className="timeline-title">Menu</h2>
                <span>{theme}</span>
              </div>
              <div className="menu-actions">
                <button type="button" onClick={() => loadEntryForDate(today)}>Today</button>
                <button type="button" onClick={createNewEntry}>New Entry</button>
                <button type="button" onClick={runAiInsights}>AI Insights</button>
                <button type="button" onClick={() => scrollTo(".periods")}>Week / Month</button>
                {canGenerateMemoryImage && !entry?.image_url ? <button type="button" onClick={() => scrollTo(".image-button")}>Memory Image</button> : null}
              </div>
              <EntryFilterTabs value={entryFilter} onChange={setEntryFilter} />
              <div className="search-box">
                <Search size={16} />
                <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search memories" />
              </div>
              <div className="timeline-list">
                {filteredEntries.map((item) => (
                  <button
                    className={item.id === selectedEntryId ? "timeline-item active" : "timeline-item"}
                    key={item.id}
                    type="button"
                    onClick={() => {
                      applyEntry(item);
                      setTimelineOpen(false);
                    }}
                  >
                    {item.image_url ? <img src={item.image_url} alt="" /> : <Cloud className="timeline-cloud" size={18} />}
                    <span>{entryLabel(item, filteredEntries)}</span>
                    <small>{item.summary || item.content || "A quiet page"}</small>
                  </button>
                ))}
              </div>
              {filteredEntries.length === 0 ? (
                <p className="timeline-empty">
                  No saved entries yet. Once today's page saves, it will appear here with older memories.
                </p>
              ) : null}
            </motion.aside>
          ) : null}
        </AnimatePresence>

        <section className="journal-page">
          {issue ? <IssueNotice issue={issue} /> : null}
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="entry-heading">
            <h1>{greeting()}</h1>
            <time>{longDate(selectedDate)}</time>
          </motion.div>

          {entry?.image_url ? (
            <figure className="memory-image">
              <img src={entry.image_url} alt="Generated memory visualization" />
              <div className="memory-image-actions">
                <button type="button" onClick={generateMemoryImage} disabled={imageState === "generating"} aria-label="Regenerate memory image">
                  <Image size={16} />
                </button>
                <button type="button" onClick={downloadMemoryImage} aria-label="Download memory image">
                  <Download size={16} />
                </button>
              </div>
            </figure>
          ) : null}

          <textarea
            ref={editorRef}
            value={content}
            onChange={(event) => setContent(event.target.value)}
            placeholder="How are you feeling today?"
            className="journal-editor"
            aria-label="Journal entry"
          />

          {speech.transcript ? <div className="live-transcript">{speech.transcript}</div> : null}

          <footer className="entry-actions">
            <div className="voice-control">
              <button
                className={speech.isListening ? "voice-button listening" : "voice-button"}
                type="button"
                onClick={speech.isListening ? speech.stop : speech.start}
                disabled={!speech.supported}
                aria-label={speech.isListening ? "Stop dictation" : "Start dictation"}
                title={speech.supported ? (speech.isListening ? "Stop dictation" : "Start dictation") : "Dictation is unavailable in this browser"}
              >
                <Mic />
              </button>
              {!speech.supported ? <span className="voice-note">Dictation unavailable</span> : null}
            </div>
            <div className="save-cluster">
              <button className="save-now-button" type="button" onClick={() => persist(content)} disabled={saveState === "saving"}>
                Save now
              </button>
              <SaveStatus state={saveState} />
            </div>
          </footer>

          <ReflectionPanel insight={insight} state={insightState} error={insightError} onReflect={() => refreshInsight(true)} />

          {canGenerateMemoryImage && !entry?.image_url ? (
            <button className="image-button" type="button" onClick={generateMemoryImage} disabled={imageState === "generating"}>
              <Image size={18} />
              {imageState === "generating" ? "Generating..." : "Generate Memory Image"}
            </button>
          ) : null}

          {imageState === "warning" ? <p className="image-note">{imageError}</p> : null}
          {imageState === "error" ? <p className="image-error">{imageError}</p> : null}

          {memory ? (
            <aside className="memory-revisit">
              <span>{memory.entry_date === dateYearsAgo(1) ? "One Year Ago Today" : "Six Months Ago"}</span>
              <p>{memory.summary || memory.content.slice(0, 180)}</p>
            </aside>
          ) : null}

          <section className="periods">
            {weekly ? <PeriodCard icon={<Sparkles />} title="This Week" body={weekly} /> : null}
            {monthly ? <PeriodCard icon={<Moon />} title="This Month" body={monthly} /> : null}
          </section>
        </section>
      </div>
      <button className="new-entry-fab" type="button" onClick={createNewEntry} aria-label="New entry" title="New entry">
        <Plus />
      </button>
    </main>
  );
}

function SaveStatus({ state }: { state: SaveState }) {
  if (state === "saving") return <span className="save-status">Saving...</span>;
  if (state === "saved") return <span className="save-status">Saved <Check size={14} /></span>;
  if (state === "error") return <span className="save-status error">Offline</span>;
  return <span className="save-status">Ready</span>;
}

function IssueNotice({ issue }: { issue: AppIssue }) {
  return (
    <section className="issue-notice">
      <strong>{issue.title}</strong>
      <p>{issue.detail}</p>
    </section>
  );
}

function ReflectionPanel({
  insight,
  state,
  error,
  onReflect,
}: {
  insight: EntryInsight;
  state: "idle" | "reflecting" | "error";
  error: string;
  onReflect: () => void;
}) {
  if (!insight.reflection && !insight.mood && insight.themes.length === 0 && insight.cards.length === 0) {
    return (
      <section className="reflection reflection-empty">
        <div className="reflection-header">
          <h2>Reflection</h2>
          <button type="button" onClick={onReflect} disabled={state === "reflecting"}>
            {state === "reflecting" ? "Reflecting..." : "Reflect now"}
          </button>
        </div>
        <p>Write a little more and a reflection will settle here.</p>
        {state === "error" ? <p className="image-error">{error}</p> : null}
      </section>
    );
  }

  return (
    <section className="reflection">
      <div className="reflection-header">
        <h2>Reflection</h2>
        <button type="button" onClick={onReflect} disabled={state === "reflecting"}>
          {state === "reflecting" ? "Reflecting..." : "Reflect now"}
        </button>
      </div>
      {insight.reflection ? <p>{insight.reflection}</p> : null}
      {insight.cards.length ? (
        <div className="insight-grid">
          {insight.cards.map((card) => (
            <InsightCardView key={card.title} card={card} />
          ))}
        </div>
      ) : null}
      <div className="chips">
        {insight.mood ? <span>{insight.mood}</span> : null}
        {insight.themes.map((theme) => (
          <span key={theme}>{theme}</span>
        ))}
      </div>
      {state === "error" ? <p className="image-error">{error}</p> : null}
    </section>
  );
}

function InsightCardView({ card }: { card: InsightCard }) {
  return (
    <article className="insight-card">
      <h3>{card.title}</h3>
      <p>{card.body}</p>
      {card.items?.length ? (
        <ul>
          {card.items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      ) : null}
    </article>
  );
}

function PeriodCard({ icon, title, body }: { icon: JSX.Element; title: string; body: string }) {
  return (
    <article className="period-card">
      {icon}
      <h2>{title}</h2>
      <p>{body}</p>
    </article>
  );
}

type EntryFilter = "daily" | "weekly" | "monthly";

function EntryFilterTabs({ value, onChange }: { value: EntryFilter; onChange: (value: EntryFilter) => void }) {
  return (
    <div className="entry-filter" aria-label="Filter entries">
      {(["daily", "weekly", "monthly"] as EntryFilter[]).map((filter) => (
        <button className={value === filter ? "active" : ""} key={filter} type="button" onClick={() => onChange(filter)}>
          {filter}
        </button>
      ))}
    </div>
  );
}

function isEntryInFilter(entryDate: string, filter: EntryFilter) {
  const date = new Date(`${entryDate}T12:00:00`);
  const start = new Date();
  start.setHours(0, 0, 0, 0);

  if (filter === "daily") return entryDate === isoToday(start);

  if (filter === "weekly") start.setDate(start.getDate() - 6);
  if (filter === "monthly") start.setDate(start.getDate() - 30);
  return date >= start;
}

function buildStoredInsightCards(entry: JournalEntry): InsightCard[] {
  const cards: InsightCard[] = [];
  if (entry.summary) cards.push({ title: "Entry Summary", body: entry.summary });
  if (entry.reflection) cards.push({ title: "Reflection", body: entry.reflection });
  if (entry.mood) cards.push({ title: "Emotional Tone", body: entry.mood });
  if (entry.themes?.length) cards.push({ title: "Themes", body: "Recurring patterns noticed in this entry.", items: entry.themes });
  return cards;
}

async function analyzeEntry(content: string) {
  try {
    const response = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    });
    if (!response.ok) return null;
    return (await response.json()) as EntryInsight;
  } catch {
    return null;
  }
}

function buildPeriodReflection(entries: JournalEntry[], period: "week" | "month") {
  const written = entries.filter((item) => item.content.trim().length > 0);
  if (!written.length) return "";
  const moods = written.map((item) => item.mood).filter(Boolean);
  const themes = written.flatMap((item) => item.themes || []);
  const topThemes = countTop(themes).slice(0, 3).join(", ");
  const topMood = countTop(moods as string[])[0];
  const daysText = period === "week" ? `${written.length} day${written.length === 1 ? "" : "s"}` : `${written.length} entries`;
  return `You wrote on ${daysText}. ${topThemes ? `Common themes: ${topThemes}. ` : ""}${topMood ? `Overall mood: ${topMood}.` : ""}`;
}

function countTop(values: string[]) {
  const counts = values.reduce<Record<string, number>>((acc, value) => {
    acc[value] = (acc[value] || 0) + 1;
    return acc;
  }, {});
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([value]) => value);
}

function imageExtension(imageUrl: string) {
  const match = imageUrl.match(/^data:([^;,]+)/);
  const mimeType = match?.[1] || "";
  if (mimeType.includes("svg")) return "svg";
  if (mimeType.includes("jpeg") || mimeType.includes("jpg")) return "jpg";
  if (mimeType.includes("webp")) return "webp";
  return "png";
}

function localPreviewInsight(content: string): EntryInsight {
  const lower = content.toLowerCase();
  const mood = lower.match(/\b(anxious|worried|heavy|tired)\b/) ? "Anxious" : lower.match(/\b(excited|hopeful|happy|alive)\b/) ? "Hopeful" : "Reflective";
  const themes = [
    lower.includes("create") || lower.includes("art") ? "Creativity" : "",
    lower.includes("work") || lower.includes("business") ? "Business" : "",
    lower.includes("family") || lower.includes("friend") ? "Relationships" : "",
    lower.includes("dream") ? "Dreams" : "",
    lower.includes("grow") || lower.includes("learn") ? "Growth" : "",
  ].filter(Boolean);

  return {
    summary: content.trim().split(/[.!?]/)[0].slice(0, 160),
    reflection: `You seem to be carrying a ${mood.toLowerCase()} energy through this entry.`,
    mood,
    themes: themes.length ? themes : ["Reflection"],
    isDreamLike: /\b(dream|surreal|imagined|floating|vision)\b/i.test(content),
    imagePrompt: "",
    cards: [
      {
        title: "Entry Summary",
        body: content.trim().split(/[.!?]/)[0].slice(0, 160) || "This page is ready for a private reflection.",
      },
      {
        title: "Emotional Tone",
        body: `The entry carries a ${mood.toLowerCase()} tone${themes.length ? ` around ${themes.slice(0, 3).join(", ")}` : ""}.`,
      },
    ],
  };
}

function databaseIssue(message: string): AppIssue {
  const normalized = message.toLowerCase();
  if (normalized.includes("entry_index") || normalized.includes("schema cache")) {
    return {
      title: "Database schema needs updating",
      detail: "Run the latest supabase/schema.sql in Supabase SQL Editor. It adds entry numbers so multiple entries can exist on the same date.",
    };
  }

  if (normalized.includes("relation") || normalized.includes("does not exist")) {
    return {
      title: "Database tables are missing",
      detail: "Run supabase/schema.sql in the Supabase SQL editor. Until those tables exist, entries cannot save and the menu will stay empty.",
    };
  }

  if (normalized.includes("row-level security") || normalized.includes("permission") || normalized.includes("policy")) {
    return {
      title: "Database policy blocked saving",
      detail: "Supabase rejected the journal entry. Re-run the RLS policies in supabase/schema.sql and make sure you are signed in.",
    };
  }

  return {
    title: "Saving is blocked",
    detail: message || "Supabase returned an error while opening or saving today's entry.",
  };
}

function entryLabel(entry: JournalEntry, visibleEntries: JournalEntry[]) {
  const editedAt = entry.updated_at || entry.created_at;
  return editedDateTime(editedAt, hasMatchingEditMinute(entry, visibleEntries));
}

function hasMatchingEditMinute(entry: JournalEntry, visibleEntries: JournalEntry[]) {
  const editedAt = editMinuteKey(entry);
  return visibleEntries.some((item) => item.id !== entry.id && editMinuteKey(item) === editedAt);
}

function editMinuteKey(entry: JournalEntry) {
  const date = new Date(entry.updated_at || entry.created_at);
  date.setSeconds(0, 0);
  return date.getTime();
}

function editedDateTime(value: string, includeSeconds: boolean) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: includeSeconds ? "2-digit" : undefined,
  }).format(new Date(value));
}
