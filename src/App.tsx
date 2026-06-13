import { Session, User } from "@supabase/supabase-js";
import {
  ArrowLeft,
  AtSign,
  BarChart3,
  Bell,
  BookOpen,
  Camera,
  Check,
  Cloud,
  Compass,
  Download,
  Heart,
  Home,
  Image,
  Info,
  Link as LinkIcon,
  LogOut,
  MessageCircle,
  Mic,
  Moon,
  MoreVertical,
  PanelLeftClose,
  PanelLeftOpen,
  PenLine,
  Plus,
  Search,
  Send,
  Sparkles,
  Star,
  Trash2,
  UserRound,
  X as CloseIcon,
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent } from "react";
import { useSpeechRecognition } from "./hooks/useSpeechRecognition";
import { dateMonthsAgo, dateYearsAgo, greeting, isoToday, longDate, themeForTime } from "./lib/date";
import { hasSupabaseConfig, supabase } from "./lib/supabase";
import type { AppIssue, EntryInsight, InsightCard, JournalEntry, SaveState, UserProfile } from "./types";

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

type MockNotification = {
  id: string;
  type: "dream_match" | "reflection_ready" | "memory_image" | "accepted_share" | "system";
  title: string;
  body: string;
  time: string;
  isRead: boolean;
};

type ShareableDream = {
  id: string;
  date: string;
  excerpt: string;
  content: string;
  matchScore: number;
};

type CommandView = "archive" | "insights" | "analytics";

type SocialStage = "none" | "consent" | "share" | "chat";

type ChatMessage = {
  id: string;
  author: "you" | "other" | "system";
  body: string;
  time: string;
};

const initialNotifications: MockNotification[] = [
  {
    id: "match-spiral-library",
    type: "dream_match",
    title: "Dream connection",
    body: "A dreamer shares patterns with your recent entries. Explore?",
    time: "2 min ago",
    isRead: false,
  },
  {
    id: "reflection-ready",
    type: "reflection_ready",
    title: "Your reflection is ready",
    body: "June 12 entry",
    time: "Yesterday",
    isRead: false,
  },
  {
    id: "memory-image",
    type: "memory_image",
    title: "Memory image generated",
    body: "June 11 entry",
    time: "2 days ago",
    isRead: true,
  },
];

const otherPinnedDream: ShareableDream = {
  id: "other-dream",
  date: "June 10",
  excerpt: "A corridor of mirrors opened into a quiet library under violet rain.",
  content:
    "A corridor of mirrors opened into a quiet library under violet rain. Every reflection showed a different doorway, but the same silver thread appeared in each room.",
  matchScore: 0.91,
};

const initialChatMessages: ChatMessage[] = [
  { id: "m1", author: "other", body: "This is strange. I had mirrors in mine too.", time: "9:12 PM" },
  { id: "m2", author: "you", body: "What was at the end of your corridor?", time: "9:14 PM" },
  { id: "m3", author: "system", body: "No identities are shared unless both dreamers choose that step.", time: "Now" },
];

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
  const timelineGestureRef = useRef<{ id: string; x: number; y: number; longPressTimer: number | null } | null>(null);
  const suppressTimelineOpenRef = useRef("");
  const handledDateSelectionRef = useRef("");
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
  const [commandView, setCommandView] = useState<CommandView>("archive");
  const [timelineOpen, setTimelineOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [deleteActionId, setDeleteActionId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
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
  const [rangeInsight, setRangeInsight] = useState<EntryInsight>(emptyInsight);
  const [rangeInsightFilter, setRangeInsightFilter] = useState<EntryFilter | null>(null);
  const [rangeInsightState, setRangeInsightState] = useState<"idle" | "reflecting" | "error">("idle");
  const [rangeInsightError, setRangeInsightError] = useState("");
  const [issue, setIssue] = useState<AppIssue | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [profileForm, setProfileForm] = useState<ProfileForm>(() => profileFormFromUser(user));
  const [profileState, setProfileState] = useState<"idle" | "loading" | "saving" | "saved" | "error">("idle");
  const [profileError, setProfileError] = useState("");
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notifications, setNotifications] = useState<MockNotification[]>(initialNotifications);
  const [socialStage, setSocialStage] = useState<SocialStage>("none");
  const [shareAnonymously, setShareAnonymously] = useState(true);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>(initialChatMessages);
  const [chatDraft, setChatDraft] = useState("");

  useEffect(() => {
    const timer = window.setInterval(() => setAutoTheme(themeForTime()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    document.body.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    if (!searchOpen) return;
    setTimelineOpen(false);
    setNotificationsOpen(false);
  }, [searchOpen]);

  const loadProfile = useCallback(async () => {
    setProfileState("loading");
    const { data, error } = await supabase.from("profiles").select("*").eq("id", user.id).maybeSingle();

    if (error) {
      setProfileState("error");
      setProfileError(profileIssue(error.message));
      setProfileForm(profileFormFromUser(user));
      return;
    }

    const nextProfile = (data as UserProfile | null) || null;
    setProfile(nextProfile);
    setProfileForm(profileFormFromUser(user, nextProfile));
    setProfileError("");
    setProfileState("idle");
  }, [user]);

  useEffect(() => {
    void loadProfile();
  }, [loadProfile]);

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
    handledDateSelectionRef.current = nextEntry.entry_date;
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
    if (handledDateSelectionRef.current === selectedDate) {
      handledDateSelectionRef.current = "";
      return;
    }
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

  const rangeEntries = useMemo(() => {
    const source = entries.map((item) =>
      item.id === entry?.id
        ? {
            ...item,
            content,
            summary: insight.summary || item.summary,
            reflection: insight.reflection || item.reflection,
            mood: insight.mood || item.mood,
            themes: insight.themes.length ? insight.themes : item.themes,
          }
        : item,
    );

    if (entry && !source.some((item) => item.id === entry.id)) {
      source.unshift({
        ...entry,
        content,
        summary: insight.summary || entry.summary,
        reflection: insight.reflection || entry.reflection,
        mood: insight.mood || entry.mood,
        themes: insight.themes.length ? insight.themes : entry.themes,
      });
    }

    return source.filter((item) => isEntryInFilter(item.entry_date, entryFilter));
  }, [content, entries, entry, entryFilter, insight]);

  const filteredEntries = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rangeEntries.filter((item) => {
      const matchesSearch = !needle || entryMatchesQuery(item, needle, entries);
      return matchesSearch;
    });
  }, [entries, query, rangeEntries]);

  const rangeAnalytics = useMemo(() => buildRangeAnalytics(rangeEntries, entryFilter), [entryFilter, rangeEntries]);

  const searchResults = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matches = needle ? entries.filter((item) => entryMatchesQuery(item, needle, entries)) : entries;
    return matches.slice(0, 12);
  }, [entries, query]);

  const shareableDreams = useMemo<ShareableDream[]>(() => {
    const fromEntries = entries
      .filter((item) => item.content.trim().length > 0)
      .slice(0, 4)
      .map((item) => ({
        id: item.id,
        date: longDate(item.entry_date),
        excerpt: entryExcerpt(item.content),
        content: item.content,
        matchScore: mockDreamMatchScore(item),
      }))
      .sort((a, b) => b.matchScore - a.matchScore);

    if (fromEntries.length) return fromEntries;
    return [
      {
        id: entry?.id || "current-dream",
        date: entry ? longDate(entry.entry_date) : longDate(today),
        excerpt: entryExcerpt(content) || "The current page is ready to become a shared dream preview.",
        content: content || "The current page is ready to become a shared dream preview.",
        matchScore: mockTextMatchScore(content),
      },
    ];
  }, [content, entries, entry, today]);

  const selectedShareDream = shareableDreams[0];
  const unreadCount = notifications.filter((item) => !item.isRead).length;
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

  async function runRangeInsights() {
    setCommandView("insights");
    const prompt = buildRangeInsightPrompt(rangeEntries, entryFilter);

    if (!prompt) {
      setRangeInsightState("error");
      setRangeInsightError(`No written dreams in the selected ${entryFilter} range yet.`);
      setRangeInsight(emptyInsight);
      setRangeInsightFilter(entryFilter);
      return;
    }

    setRangeInsightState("reflecting");
    setRangeInsightError("");
    setRangeInsightFilter(entryFilter);

    try {
      const nextInsight = await analyzeEntry(prompt);
      if (!nextInsight) throw new Error("Range reading could not be generated.");
      setRangeInsight(nextInsight);
      setRangeInsightState("idle");
    } catch (error) {
      setRangeInsightState("error");
      setRangeInsightError(error instanceof Error ? error.message : "Range reading could not be generated.");
    }
  }

  function markAllNotificationsRead() {
    setNotifications((current) => current.map((item) => ({ ...item, isRead: true })));
  }

  function markNotificationRead(id: string) {
    setNotifications((current) => current.map((item) => (item.id === id ? { ...item, isRead: true } : item)));
  }

  function openDreamMatchFlow(notificationId = "match-spiral-library") {
    markNotificationRead(notificationId);
    setNotificationsOpen(false);
    setSocialStage("consent");
  }

  function skipDreamMatch(notificationId: string) {
    markNotificationRead(notificationId);
  }

  function openShareChoice() {
    setSocialStage("share");
  }

  function openDreamCircle() {
    setNotifications((current) =>
      current.map((item) => (item.id === "match-spiral-library" ? { ...item, isRead: true, title: "Dream circle opened" } : item)),
    );
    setSocialStage("chat");
  }

  function sendChatMessage() {
    const nextMessage = chatDraft.trim();
    if (!nextMessage) return;
    setChatMessages((current) => [
      ...current,
      { id: `local-${Date.now()}`, author: "you", body: nextMessage, time: "Now" },
    ]);
    setChatDraft("");
  }

  function clearTimelineGesture() {
    if (timelineGestureRef.current?.longPressTimer) {
      window.clearTimeout(timelineGestureRef.current.longPressTimer);
    }
    timelineGestureRef.current = null;
  }

  function revealDeleteAction(id: string) {
    setDeleteActionId(id);
    suppressTimelineOpenRef.current = id;
  }

  function beginTimelineGesture(id: string, event: PointerEvent) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    clearTimelineGesture();
    timelineGestureRef.current = {
      id,
      x: event.clientX,
      y: event.clientY,
      longPressTimer: window.setTimeout(() => revealDeleteAction(id), 560),
    };
  }

  function moveTimelineGesture(id: string, event: PointerEvent) {
    const gesture = timelineGestureRef.current;
    if (!gesture || gesture.id !== id) return;
    const deltaX = event.clientX - gesture.x;
    const deltaY = event.clientY - gesture.y;

    if (Math.abs(deltaX) > 8 || Math.abs(deltaY) > 8) {
      if (gesture.longPressTimer) {
        window.clearTimeout(gesture.longPressTimer);
        gesture.longPressTimer = null;
      }
    }

    if (deltaX < -44 && Math.abs(deltaY) < 28) {
      revealDeleteAction(id);
      clearTimelineGesture();
    }
  }

  function endTimelineGesture() {
    clearTimelineGesture();
  }

  async function deleteEntry(target: JournalEntry) {
    setDeletingId(target.id);
    const { error } = await supabase.from("journal_entries").delete().eq("id", target.id).eq("user_id", user.id);
    setDeletingId(null);

    if (error) {
      setIssue(databaseIssue(error.message));
      return;
    }

    localStorage.removeItem(draftKeyFor(target.id));
    setDeleteActionId(null);
    setIssue(null);

    const remaining = entries.filter((item) => item.id !== target.id);
    setEntries(remaining);
    if (target.id === selectedEntryId) {
      const nextEntry = remaining[0];
      if (nextEntry) {
        applyEntry(nextEntry);
      } else {
        setEntry(null);
        setSelectedEntryId(null);
        setContent("");
        await loadEntryForDate(today);
      }
    }
    await loadEntries();
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

  async function saveProfile() {
    const normalized = normalizeProfileForm(profileForm);
    const validationError = validateProfileForm(normalized);

    if (validationError) {
      setProfileState("error");
      setProfileError(validationError);
      return;
    }

    setProfileState("saving");
    setProfileError("");

    const { data, error } = await supabase
      .from("profiles")
      .upsert(
        {
          id: user.id,
          username: nullableProfileValue(normalized.username),
          display_name: nullableProfileValue(normalized.display_name),
          avatar_url: nullableProfileValue(profileAvatar(user)),
          bio: nullableProfileValue(normalized.bio),
          instagram_handle: nullableProfileValue(stripHandlePrefix(normalized.instagram_handle)),
          tiktok_handle: nullableProfileValue(stripHandlePrefix(normalized.tiktok_handle)),
          extra_links: buildExtraLinks(normalized),
          matching_enabled: normalized.matching_enabled,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "id" },
      )
      .select("*")
      .single();

    if (error) {
      setProfileState("error");
      setProfileError(profileIssue(error.message));
      return;
    }

    const nextProfile = data as UserProfile;
    setProfile(nextProfile);
    setProfileForm(profileFormFromUser(user, nextProfile));
    await supabase.auth.updateUser({
      data: {
        display_name: normalized.display_name || undefined,
        full_name: normalized.display_name || undefined,
        username: normalized.username || undefined,
      },
    });
    setProfileState("saved");
    window.setTimeout(() => setProfileState("idle"), 1400);
  }

  function openSearchResult(item: JournalEntry) {
    applyEntry(item);
    setSearchOpen(false);
    setTimelineOpen(false);
    setProfileOpen(false);
    setNotificationsOpen(false);
  }

  return (
    <main className={`app-shell theme-${theme}`}>
      <div className="paper-grain" />
      <header className="top-bar">
        <button
          className={searchOpen ? "icon-button search-trigger active" : "icon-button search-trigger"}
          type="button"
          onClick={() => {
            setSearchOpen((open) => !open);
            setTimelineOpen(false);
            setNotificationsOpen(false);
          }}
          aria-label="Search entries"
          title="Search entries"
        >
          <Search />
        </button>
        <div className="top-actions">
          <button
            className={notificationsOpen ? "icon-button notification-button active" : "icon-button notification-button"}
            type="button"
            onClick={() => setNotificationsOpen((open) => !open)}
            aria-label="Notifications"
            title="Notifications"
          >
            <Bell />
            {unreadCount > 0 ? <span className="notification-badge">{unreadCount > 9 ? "9+" : unreadCount}</span> : null}
          </button>
        </div>
      </header>

      <AnimatePresence>
        {searchOpen ? (
          <SearchPanel
            query={query}
            results={searchResults}
            onQueryChange={setQuery}
            onClose={() => setSearchOpen(false)}
            onOpenEntry={openSearchResult}
          />
        ) : null}
        {notificationsOpen ? (
          <NotificationDrawer
            notifications={notifications}
            onClose={() => setNotificationsOpen(false)}
            onMarkAllRead={markAllNotificationsRead}
            onOpenDreamMatch={openDreamMatchFlow}
            onSkipDreamMatch={skipDreamMatch}
            onReadNotification={markNotificationRead}
          />
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {socialStage === "consent" ? (
          <MatchConsentOverlay onClose={() => setSocialStage("none")} onAccept={openShareChoice} onDecline={() => setSocialStage("none")} />
        ) : null}
        {socialStage === "share" ? (
          <ShareDreamOverlay
            dream={selectedShareDream}
            anonymous={shareAnonymously}
            onBack={() => setSocialStage("consent")}
            onClose={() => setSocialStage("none")}
            onAnonymousChange={setShareAnonymously}
            onShare={openDreamCircle}
          />
        ) : null}
        {socialStage === "chat" ? (
          <DreamCircleChat
            yourDream={selectedShareDream}
            theirDream={otherPinnedDream}
            anonymous={shareAnonymously}
            messages={chatMessages}
            draft={chatDraft}
            currentUserName={profileForm.display_name || profileForm.username || user.email?.split("@")[0] || "You"}
            currentUserAvatar={profileAvatar(user)}
            currentUserInitials={profileInitials(user, profileForm)}
            onBack={() => setSocialStage("none")}
            onDraftChange={setChatDraft}
            onSend={sendChatMessage}
          />
        ) : null}
      </AnimatePresence>

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
                <div>
                  <h2 className="timeline-title">Command Center</h2>
                  <span>Dream archive</span>
                </div>
                <span>{theme}</span>
              </div>
              <div className="menu-actions command-tabs">
                <button
                  className={commandView === "archive" ? "active" : ""}
                  type="button"
                  onClick={() => {
                    setCommandView("archive");
                    void loadEntryForDate(today);
                  }}
                >
                  <Home />
                  <span>Today</span>
                </button>
                <button className={commandView === "insights" ? "active" : ""} type="button" onClick={() => void runRangeInsights()}>
                  <Sparkles />
                  <span>AI Insights</span>
                </button>
                <button className={commandView === "analytics" ? "active" : ""} type="button" onClick={() => setCommandView("analytics")}>
                  <BarChart3 />
                  <span>Analytics</span>
                </button>
              </div>
              <EntryFilterTabs value={entryFilter} onChange={setEntryFilter} />
              {commandView === "archive" ? (
                <>
                  <div className="search-box">
                    <Search size={16} />
                    <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search memories" />
                    <button type="button" onClick={createNewEntry} aria-label="New entry">
                      <Plus />
                    </button>
                  </div>
                  <div className="timeline-list">
                    {filteredEntries.map((item) => (
                      <div className={deleteActionId === item.id ? "timeline-entry reveal-delete" : "timeline-entry"} key={item.id}>
                        <button
                          className={item.id === selectedEntryId ? "timeline-item active" : "timeline-item"}
                          type="button"
                          onPointerDown={(event) => beginTimelineGesture(item.id, event)}
                          onPointerMove={(event) => moveTimelineGesture(item.id, event)}
                          onPointerUp={endTimelineGesture}
                          onPointerCancel={endTimelineGesture}
                          onContextMenu={(event) => {
                            event.preventDefault();
                            revealDeleteAction(item.id);
                          }}
                          onClick={() => {
                            if (suppressTimelineOpenRef.current === item.id) {
                              suppressTimelineOpenRef.current = "";
                              return;
                            }
                            if (deleteActionId === item.id) {
                              setDeleteActionId(null);
                              return;
                            }
                            applyEntry(item);
                            setTimelineOpen(false);
                          }}
                        >
                          {item.image_url ? <img src={item.image_url} alt="" /> : <Cloud className="timeline-cloud" size={18} />}
                          <span>{entryTitle(item)}</span>
                          <time>{entryLabel(item, filteredEntries)}</time>
                          <small>{item.summary || item.content || "A quiet page"}</small>
                        </button>
                        <button
                          className="timeline-more"
                          type="button"
                          onClick={() => revealDeleteAction(item.id)}
                          aria-label="Entry actions"
                        >
                          <MoreVertical size={15} />
                        </button>
                        <button
                          className="timeline-delete"
                          type="button"
                          disabled={deletingId === item.id}
                          onClick={() => void deleteEntry(item)}
                          aria-label="Delete entry"
                          title="Delete entry"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    ))}
                  </div>
                  {filteredEntries.length === 0 ? (
                    <p className="timeline-empty">
                      No saved entries yet. Once today's page saves, it will appear here with older memories.
                    </p>
                  ) : null}
                </>
              ) : null}
              {commandView === "insights" ? (
                <RangeInsightPanel
                  filter={entryFilter}
                  entryCount={rangeAnalytics.entries}
                  insight={rangeInsightFilter === entryFilter ? rangeInsight : emptyInsight}
                  state={rangeInsightState}
                  error={rangeInsightError}
                  onReflect={() => void runRangeInsights()}
                />
              ) : null}
              {commandView === "analytics" ? <RangeAnalyticsPanel analytics={rangeAnalytics} /> : null}
            </motion.aside>
          ) : null}
        </AnimatePresence>

        <section className="journal-page">
          <AnimatePresence>
            {profileOpen ? (
              <ProfilePanel
                user={user}
                profile={profile}
                form={profileForm}
                state={profileState}
                error={profileError}
                onChange={setProfileForm}
                onSave={saveProfile}
                onSignOut={() => supabase.auth.signOut()}
              />
            ) : null}
          </AnimatePresence>
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
      <BottomNav
        onHome={() => loadEntryForDate(today)}
        onJournal={() => {
          setTimelineOpen(true);
          setProfileOpen(false);
        }}
        onInsights={runAiInsights}
        onDiscover={() => {
          setNotificationsOpen(false);
          setSocialStage("consent");
        }}
        onProfile={() => {
          setProfileOpen(true);
          setTimelineOpen(false);
        }}
      />
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

function BottomNav({
  onHome,
  onJournal,
  onInsights,
  onDiscover,
  onProfile,
}: {
  onHome: () => void;
  onJournal: () => void;
  onInsights: () => void;
  onDiscover: () => void;
  onProfile: () => void;
}) {
  return (
    <nav className="bottom-nav" aria-label="Primary navigation">
      <button type="button" onClick={onHome}>
        <Home />
        <span>Home</span>
      </button>
      <button type="button" onClick={onJournal}>
        <PenLine />
        <span>Journal</span>
      </button>
      <button type="button" onClick={onInsights}>
        <Sparkles />
        <span>AI</span>
      </button>
      <button type="button" onClick={onDiscover}>
        <Compass />
        <span>Discover</span>
      </button>
      <button type="button" onClick={onProfile}>
        <UserRound />
        <span>Profile</span>
      </button>
    </nav>
  );
}

function SearchPanel({
  query,
  results,
  onQueryChange,
  onClose,
  onOpenEntry,
}: {
  query: string;
  results: JournalEntry[];
  onQueryChange: (value: string) => void;
  onClose: () => void;
  onOpenEntry: (entry: JournalEntry) => void;
}) {
  return (
    <motion.aside
      className="global-search-panel"
      initial={{ opacity: 0, y: -8, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -8, scale: 0.98 }}
      transition={{ duration: 0.18 }}
      aria-label="Search entries"
    >
      <div className="global-search-box">
        <Search size={16} />
        <input
          autoFocus
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Search words or dates"
          aria-label="Search older entries by words or date"
        />
        <button type="button" onClick={onClose} aria-label="Close search">
          <CloseIcon size={16} />
        </button>
      </div>
      <div className="search-results-list">
        {results.map((item) => (
          <button className="search-result-row" key={item.id} type="button" onClick={() => onOpenEntry(item)}>
            {item.image_url ? <img src={item.image_url} alt="" /> : <Cloud className="timeline-cloud" size={18} />}
            <span>{entryTitle(item)}</span>
            <time>{longDate(item.entry_date)}</time>
            <small>{item.summary || item.content || "A quiet page"}</small>
          </button>
        ))}
      </div>
      {results.length === 0 ? (
        <p className="search-empty">No entries match that search. Try a word, month, or exact date.</p>
      ) : null}
    </motion.aside>
  );
}

function NotificationDrawer({
  notifications,
  onClose,
  onMarkAllRead,
  onOpenDreamMatch,
  onSkipDreamMatch,
  onReadNotification,
}: {
  notifications: MockNotification[];
  onClose: () => void;
  onMarkAllRead: () => void;
  onOpenDreamMatch: (id: string) => void;
  onSkipDreamMatch: (id: string) => void;
  onReadNotification: (id: string) => void;
}) {
  return (
    <motion.aside
      className="notification-drawer"
      initial={{ opacity: 0, x: 28 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 28 }}
      transition={{ duration: 0.22 }}
      aria-label="Notifications"
    >
      <div className="notification-head">
        <h2>Notifications</h2>
        <button className="icon-button" type="button" onClick={onClose} aria-label="Close notifications">
          <CloseIcon />
        </button>
      </div>
      <button className="text-button notification-read-all" type="button" onClick={onMarkAllRead}>
        Mark all read
      </button>
      <div className="notification-list">
        {notifications.map((item) => (
          <article className={item.isRead ? "notification-item" : "notification-item unread"} key={item.id}>
            <div className="notification-icon">{notificationIcon(item.type)}</div>
            <button
              className="notification-copy"
              type="button"
              onClick={() => (item.type === "dream_match" ? onOpenDreamMatch(item.id) : onReadNotification(item.id))}
            >
              <strong>{item.title}</strong>
              <span>{item.body}</span>
              <small>{item.time}</small>
            </button>
            {item.type === "dream_match" ? (
              <div className="notification-actions">
                <button type="button" onClick={() => onOpenDreamMatch(item.id)}>Accept</button>
                <button type="button" onClick={() => onSkipDreamMatch(item.id)}>Skip</button>
              </div>
            ) : null}
          </article>
        ))}
      </div>
    </motion.aside>
  );
}

function MatchConsentOverlay({
  onClose,
  onAccept,
  onDecline,
}: {
  onClose: () => void;
  onAccept: () => void;
  onDecline: () => void;
}) {
  return (
    <motion.section
      className="social-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      aria-label="Dream match consent"
    >
      <div className="social-consent-card">
        <button className="social-close" type="button" onClick={onClose} aria-label="Close dream match">
          <CloseIcon />
        </button>
        <div className="constellation-mark" aria-hidden="true">
          <Sparkles />
          <Star />
          <Sparkles />
        </div>
        <h2>A dreamer found you.</h2>
        <p>Someone has been dreaming about similar things. Their identity and dreams remain hidden.</p>
        <p>Would you like to explore a possible connection?</p>
        <button className="social-primary" type="button" onClick={onAccept}>Yes, I am curious</button>
        <div className="social-text-actions">
          <button type="button" onClick={onClose}>Not right now</button>
          <button type="button" onClick={onDecline}>Decline</button>
        </div>
        <small>Your identity stays hidden too. Nothing is shared unless both of you agree to each step.</small>
      </div>
    </motion.section>
  );
}

function ShareDreamOverlay({
  dream,
  anonymous,
  onBack,
  onClose,
  onAnonymousChange,
  onShare,
}: {
  dream?: ShareableDream;
  anonymous: boolean;
  onBack: () => void;
  onClose: () => void;
  onAnonymousChange: (value: boolean) => void;
  onShare: () => void;
}) {
  return (
    <motion.section
      className="social-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      aria-label="Choose dream to share"
    >
      <div className="share-card">
        <div className="share-head">
          <button className="icon-button" type="button" onClick={onBack} aria-label="Back to match consent">
            <ArrowLeft />
          </button>
          <h2>Choose what to share</h2>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close sharing">
            <CloseIcon />
          </button>
        </div>
        <p>The highest-scored matched dream is selected automatically so the wrong entry cannot be shared by mistake.</p>
        <article className="share-dream-card selected locked">
          <div className="match-score-row">
            <strong>{dream?.date || "Matched dream"}</strong>
            <span>{formatMatchScore(dream?.matchScore || 0)} match</span>
          </div>
          <p>{dream?.excerpt || "The matched dream preview will appear here."}</p>
          <small>Auto-selected by dream similarity score</small>
        </article>
        <div className="share-as">
          <span>Share as</span>
          <label>
            <input type="radio" checked={!anonymous} onChange={() => onAnonymousChange(false)} />
            Username
          </label>
          <label>
            <input type="radio" checked={anonymous} onChange={() => onAnonymousChange(true)} />
            Anonymous
          </label>
        </div>
        <button className="social-primary" type="button" onClick={onShare}>Share this dream</button>
        <small>You can revoke access later. This mock flow does not send anything yet.</small>
      </div>
    </motion.section>
  );
}

function DreamCircleChat({
  yourDream,
  theirDream,
  anonymous,
  messages,
  draft,
  currentUserName,
  currentUserAvatar,
  currentUserInitials,
  onBack,
  onDraftChange,
  onSend,
}: {
  yourDream?: ShareableDream;
  theirDream: ShareableDream;
  anonymous: boolean;
  messages: ChatMessage[];
  draft: string;
  currentUserName: string;
  currentUserAvatar: string;
  currentUserInitials: string;
  onBack: () => void;
  onDraftChange: (value: string) => void;
  onSend: () => void;
}) {
  return (
    <motion.section
      className="circle-chat-shell"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 12 }}
      aria-label="Dream Circle chat"
    >
      <header className="circle-chat-head">
        <button type="button" onClick={onBack} aria-label="Back to diary">
          <ArrowLeft />
        </button>
        <div>
          <h2>Dream Circle</h2>
          <span>2 dreamers</span>
        </div>
        <button type="button" aria-label="Circle menu">
          <MoreVertical />
        </button>
      </header>

      <section className="pinned-dreams" aria-label="Shared dreams">
        <div className="pinned-label">Shared dreams</div>
        <div className="pinned-grid">
          <PinnedDreamCard label={anonymous ? "Silver Moon" : "Your dream"} dream={yourDream} />
          <PinnedDreamCard label="Other dreamer" dream={theirDream} />
        </div>
      </section>

      <div className="chat-stream">
        <span className="chat-day">Today</span>
        {messages.map((message) => {
          const sender = chatSenderFor(message.author, {
            anonymous,
            currentUserName,
            currentUserAvatar,
            currentUserInitials,
          });

          return (
            <div className={`chat-row ${message.author}`} key={message.id}>
              <div className="chat-sender">
                <span className="chat-avatar">
                  {sender.avatarUrl ? <img src={sender.avatarUrl} alt="" /> : sender.initials}
                </span>
                <strong>{sender.name}</strong>
              </div>
              <p>{message.body}</p>
              <small>{message.time}</small>
            </div>
          );
        })}
      </div>

      <footer className="chat-composer">
        <input
          value={draft}
          onChange={(event) => onDraftChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") onSend();
          }}
          placeholder="Type a message..."
          aria-label="Type a message"
        />
        <button type="button" onClick={onSend} aria-label="Send message">
          <Send />
        </button>
      </footer>
    </motion.section>
  );
}

function PinnedDreamCard({ label, dream }: { label: string; dream?: ShareableDream }) {
  const [expanded, setExpanded] = useState(false);
  const dreamText = dream?.content || "A private dream preview will appear here.";

  return (
    <article className={expanded ? "pinned-dream-card expanded" : "pinned-dream-card"}>
      <strong>
        <BookOpen size={15} />
        {label}
      </strong>
      <span>{dream?.date || "Today"}</span>
      <p>{expanded ? dreamText : dream?.excerpt || dreamText}</p>
      <button type="button" onClick={() => setExpanded((open) => !open)}>
        {expanded ? "Show less" : "Read full"}
      </button>
    </article>
  );
}

function chatSenderFor(
  author: ChatMessage["author"],
  context: {
    anonymous: boolean;
    currentUserName: string;
    currentUserAvatar: string;
    currentUserInitials: string;
  },
) {
  if (author === "you") {
    return {
      name: context.anonymous ? "Silver Moon" : context.currentUserName,
      avatarUrl: context.anonymous ? "" : context.currentUserAvatar,
      initials: context.anonymous ? "SM" : context.currentUserInitials,
    };
  }

  if (author === "other") {
    return {
      name: "Other dreamer",
      avatarUrl: "",
      initials: "OD",
    };
  }

  return {
    name: "Dream Circle",
    avatarUrl: "",
    initials: "DC",
  };
}

function notificationIcon(type: MockNotification["type"]) {
  if (type === "dream_match") return <Sparkles />;
  if (type === "reflection_ready") return <Star />;
  if (type === "memory_image") return <Image />;
  if (type === "accepted_share") return <Heart />;
  return <Info />;
}

type ProfileForm = {
  username: string;
  display_name: string;
  bio: string;
  instagram_handle: string;
  tiktok_handle: string;
  website_url: string;
  matching_enabled: boolean;
};

function ProfilePanel({
  user,
  profile,
  form,
  state,
  error,
  onChange,
  onSave,
  onSignOut,
}: {
  user: User;
  profile: UserProfile | null;
  form: ProfileForm;
  state: "idle" | "loading" | "saving" | "saved" | "error";
  error: string;
  onChange: (form: ProfileForm) => void;
  onSave: () => void;
  onSignOut: () => void;
}) {
  const avatarUrl = profileAvatar(user);
  const initials = profileInitials(user, form);
  const statusText =
    state === "loading" ? "Loading profile..." : state === "saving" ? "Saving..." : state === "saved" ? "Saved" : "";

  function update<K extends keyof ProfileForm>(key: K, value: ProfileForm[K]) {
    onChange({ ...form, [key]: value });
  }

  return (
    <motion.section
      className="profile-panel"
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      transition={{ duration: 0.22 }}
      aria-label="Profile editor"
    >
      <div className="profile-head">
        <div className="profile-avatar">
          {avatarUrl ? <img src={avatarUrl} alt="" /> : <span>{initials}</span>}
          <Camera aria-hidden="true" />
        </div>
        <div>
          <h2>Your Profile</h2>
          <p>{user.email || "Signed in with Google"}</p>
        </div>
      </div>

      <div className="profile-grid">
        <label className="profile-field">
          <span>Username</span>
          <div className="profile-input with-icon">
            <AtSign size={16} />
            <input
              value={form.username}
              onChange={(event) => update("username", event.target.value)}
              placeholder="moonwatcher"
              autoComplete="username"
            />
          </div>
          <small>Use 3-24 letters, numbers, or underscores.</small>
        </label>

        <label className="profile-field">
          <span>Display name</span>
          <input
            value={form.display_name}
            onChange={(event) => update("display_name", event.target.value)}
            placeholder="How your name appears"
            maxLength={60}
          />
        </label>

        <label className="profile-field full">
          <span>Bio</span>
          <textarea
            value={form.bio}
            onChange={(event) => update("bio", event.target.value)}
            placeholder="A short line about your inner world"
            maxLength={180}
          />
        </label>

        <label className="profile-field">
          <span>Instagram</span>
          <input
            value={form.instagram_handle}
            onChange={(event) => update("instagram_handle", event.target.value)}
            placeholder="@handle"
          />
        </label>

        <label className="profile-field">
          <span>TikTok</span>
          <input
            value={form.tiktok_handle}
            onChange={(event) => update("tiktok_handle", event.target.value)}
            placeholder="@handle"
          />
        </label>

        <label className="profile-field full">
          <span>Website</span>
          <div className="profile-input with-icon">
            <LinkIcon size={16} />
            <input value={form.website_url} onChange={(event) => update("website_url", event.target.value)} placeholder="https://..." />
          </div>
        </label>
      </div>

      <label className="profile-toggle">
        <span>
          <strong>Dream matching</strong>
          <small>Allow future connected features to match similar dream themes.</small>
        </span>
        <input
          type="checkbox"
          checked={form.matching_enabled}
          onChange={(event) => update("matching_enabled", event.target.checked)}
        />
      </label>

      {error ? <p className="profile-error">{error}</p> : null}
      {profile?.updated_at ? <small className="profile-updated">Last saved {editedDateTime(profile.updated_at, false)}</small> : null}

      <div className="profile-actions">
        <span>{statusText}</span>
        <div className="profile-action-buttons">
          <button className="profile-signout-button" type="button" onClick={onSignOut}>
            <LogOut size={16} />
            Sign out
          </button>
          <button type="button" onClick={onSave} disabled={state === "saving" || state === "loading"}>
          <Check size={16} />
          Save Profile
          </button>
        </div>
      </div>
    </motion.section>
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

function RangeInsightPanel({
  filter,
  entryCount,
  insight,
  state,
  error,
  onReflect,
}: {
  filter: EntryFilter;
  entryCount: number;
  insight: EntryInsight;
  state: "idle" | "reflecting" | "error";
  error: string;
  onReflect: () => void;
}) {
  const hasReading = Boolean(insight.reflection || insight.summary || insight.cards.length || insight.themes.length || insight.mood);

  return (
    <section className="command-panel" aria-label="AI range insights">
      <div className="command-panel-head">
        <div>
          <h3>{rangeLabel(filter)} Reading</h3>
          <span>{entryCount} dream{entryCount === 1 ? "" : "s"} selected</span>
        </div>
        <button type="button" onClick={onReflect} disabled={state === "reflecting"}>
          <Sparkles size={14} />
          <span>{state === "reflecting" ? "Reading" : "Read Range"}</span>
        </button>
      </div>
      {hasReading ? (
        <>
          {insight.summary ? <p className="command-reading">{insight.summary}</p> : null}
          {insight.reflection ? <p className="command-reading">{insight.reflection}</p> : null}
          {insight.cards.length ? (
            <div className="command-card-list">
              {insight.cards.map((card) => (
                <InsightCardView key={card.title} card={card} />
              ))}
            </div>
          ) : null}
          {insight.mood || insight.themes.length ? (
            <div className="chips compact">
              {insight.mood ? <span>{insight.mood}</span> : null}
              {insight.themes.map((theme) => (
                <span key={theme}>{theme}</span>
              ))}
            </div>
          ) : null}
        </>
      ) : (
        <p className="timeline-empty">Choose Daily, Weekly, or Monthly, then ask AI to read the selected dreams as one range.</p>
      )}
      {state === "error" ? <p className="image-error">{error}</p> : null}
    </section>
  );
}

type RangeAnalytics = {
  label: string;
  entries: number;
  activeDays: number;
  totalWords: number;
  averageWords: number;
  dreamSignalCount: number;
  dreamSignalRate: number;
  topThemes: string[];
  topMood: string;
  longestEntryDate: string;
  longestEntryWords: number;
};

function RangeAnalyticsPanel({ analytics }: { analytics: RangeAnalytics }) {
  const cards = [
    { label: "Entries", value: analytics.entries.toString(), note: `${analytics.activeDays} active day${analytics.activeDays === 1 ? "" : "s"}` },
    { label: "Words", value: analytics.totalWords.toString(), note: `${analytics.averageWords} avg per entry` },
    { label: "Dream Signals", value: `${analytics.dreamSignalRate}%`, note: `${analytics.dreamSignalCount} entries with symbols` },
    {
      label: "Longest",
      value: analytics.longestEntryWords ? analytics.longestEntryWords.toString() : "0",
      note: analytics.longestEntryDate ? longDate(analytics.longestEntryDate) : "No written entries",
    },
  ];

  return (
    <section className="command-panel" aria-label="Range analytics">
      <div className="command-panel-head">
        <div>
          <h3>{analytics.label} Analytics</h3>
          <span>Selected range health</span>
        </div>
      </div>
      <div className="analytics-grid">
        {cards.map((card) => (
          <article className="analytics-card" key={card.label}>
            <span>{card.label}</span>
            <strong>{card.value}</strong>
            <small>{card.note}</small>
          </article>
        ))}
      </div>
      <div className="analytics-summary">
        <strong>Pattern reading</strong>
        <p>
          {analytics.topThemes.length
            ? `Top themes: ${analytics.topThemes.join(", ")}.`
            : "No recurring themes have been saved for this range yet."}
          {analytics.topMood ? ` Dominant mood: ${analytics.topMood}.` : ""}
        </p>
      </div>
    </section>
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

function buildRangeInsightPrompt(entries: JournalEntry[], filter: EntryFilter) {
  const written = entries
    .filter((item) => item.content.trim().length > 0)
    .sort((a, b) => a.entry_date.localeCompare(b.entry_date) || (a.entry_index || 0) - (b.entry_index || 0));

  if (!written.length) return "";

  const sections = written
    .map((item) => {
      const savedSignals = [
        item.summary ? `Saved summary: ${item.summary}` : "",
        item.mood ? `Saved mood: ${item.mood}` : "",
        item.themes?.length ? `Saved themes: ${item.themes.join(", ")}` : "",
      ]
        .filter(Boolean)
        .join("\n");
      return `Date: ${longDate(item.entry_date)}\n${savedSignals ? `${savedSignals}\n` : ""}Dream text:\n${item.content.trim()}`;
    })
    .join("\n\n---\n\n");

  return [
    `Selected range: ${rangeLabel(filter)}.`,
    "Read these dreams together. Look for recurring symbols, emotional weather, unresolved questions, contrasts, and a gentle interpretation of what the selected range may be circling around.",
    "Return a concise reading that works across the whole range, not a single-entry summary.",
    "",
    sections,
  ].join("\n");
}

function buildRangeAnalytics(entries: JournalEntry[], filter: EntryFilter): RangeAnalytics {
  const written = entries.filter((item) => item.content.trim().length > 0);
  const wordsByEntry = written.map((item) => ({ entry: item, words: wordCount(item.content) }));
  const totalWords = wordsByEntry.reduce((sum, item) => sum + item.words, 0);
  const longest = wordsByEntry.reduce<(typeof wordsByEntry)[number] | null>((best, item) => (!best || item.words > best.words ? item : best), null);
  const activeDays = new Set(written.map((item) => item.entry_date)).size;
  const dreamSignalCount = written.filter((item) => countDreamSignals(item.content) > 0).length;
  const topThemes = countTop(written.flatMap((item) => item.themes || [])).slice(0, 4);
  const topMood = countTop(written.map((item) => item.mood).filter(Boolean) as string[])[0] || "";

  return {
    label: rangeLabel(filter),
    entries: written.length,
    activeDays,
    totalWords,
    averageWords: written.length ? Math.round(totalWords / written.length) : 0,
    dreamSignalCount,
    dreamSignalRate: written.length ? Math.round((dreamSignalCount / written.length) * 100) : 0,
    topThemes,
    topMood,
    longestEntryDate: longest?.entry.entry_date || "",
    longestEntryWords: longest?.words || 0,
  };
}

function rangeLabel(filter: EntryFilter) {
  if (filter === "daily") return "Daily";
  if (filter === "weekly") return "Weekly";
  return "Monthly";
}

function wordCount(value: string) {
  return value.trim().split(/\s+/).filter(Boolean).length;
}

function countDreamSignals(value: string) {
  const text = value.toLowerCase();
  const dreamSignals = ["dream", "night", "sleep", "mirror", "water", "river", "train", "library", "door", "corridor", "floating", "memory"];
  return dreamSignals.reduce((count, signal) => count + (text.includes(signal) ? 1 : 0), 0);
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

function entryExcerpt(value: string) {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized) return "";
  return normalized.length > 116 ? `${normalized.slice(0, 113)}...` : normalized;
}

function mockDreamMatchScore(entry: JournalEntry) {
  const base = mockTextMatchScore(entry.content);
  const insightBoost = (entry.themes?.length || 0) * 0.015 + (entry.mood ? 0.025 : 0);
  return Math.min(0.96, base + insightBoost);
}

function mockTextMatchScore(value: string) {
  const text = value.toLowerCase();
  const dreamSignals = ["dream", "mirror", "water", "river", "train", "library", "door", "corridor", "floating", "memory"];
  const signalScore = dreamSignals.reduce((score, signal) => score + (text.includes(signal) ? 0.035 : 0), 0);
  const lengthScore = Math.min(0.18, value.trim().split(/\s+/).filter(Boolean).length / 600);
  return Math.min(0.94, 0.58 + signalScore + lengthScore);
}

function formatMatchScore(score: number) {
  return `${Math.round(score * 100)}%`;
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

function profileFormFromUser(user: User, profile?: UserProfile | null): ProfileForm {
  const metadata = user.user_metadata as Record<string, unknown>;
  const extraLinks = profile?.extra_links || {};
  return {
    username: profile?.username || asString(metadata.username) || "",
    display_name:
      profile?.display_name ||
      asString(metadata.display_name) ||
      asString(metadata.full_name) ||
      asString(metadata.name) ||
      user.email?.split("@")[0] ||
      "",
    bio: profile?.bio || asString(metadata.bio) || "",
    instagram_handle: displayHandle(profile?.instagram_handle || ""),
    tiktok_handle: displayHandle(profile?.tiktok_handle || ""),
    website_url: asString(extraLinks.website),
    matching_enabled: profile?.matching_enabled ?? true,
  };
}

function normalizeProfileForm(form: ProfileForm): ProfileForm {
  return {
    username: form.username.trim().toLowerCase(),
    display_name: form.display_name.trim(),
    bio: form.bio.trim(),
    instagram_handle: form.instagram_handle.trim(),
    tiktok_handle: form.tiktok_handle.trim(),
    website_url: form.website_url.trim(),
    matching_enabled: form.matching_enabled,
  };
}

function validateProfileForm(form: ProfileForm) {
  if (form.username && !/^[a-z0-9_]{3,24}$/.test(form.username)) {
    return "Username can only use 3-24 lowercase letters, numbers, or underscores.";
  }
  if (form.bio.length > 180) return "Bio must be 180 characters or less.";
  const instagramError = validateSocialHandle("Instagram", form.instagram_handle);
  if (instagramError) return instagramError;
  const tiktokError = validateSocialHandle("TikTok", form.tiktok_handle);
  if (tiktokError) return tiktokError;
  if (form.website_url && !isHttpUrl(form.website_url)) return "Website must start with http:// or https://.";
  return "";
}

function validateSocialHandle(label: string, value: string) {
  if (!value) return "";
  const handle = stripHandlePrefix(value);
  if (/^[a-zA-Z0-9._]{1,30}$/.test(handle)) return "";
  return `${label} must be a handle without spaces.`;
}

function isHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function nullableProfileValue(value: string) {
  return value.trim() || null;
}

function stripHandlePrefix(value: string) {
  return value.trim().replace(/^@+/, "");
}

function displayHandle(value: string) {
  const handle = stripHandlePrefix(value);
  return handle ? `@${handle}` : "";
}

function buildExtraLinks(form: ProfileForm) {
  return form.website_url ? { website: form.website_url } : {};
}

function profileInitials(user: User, form: ProfileForm) {
  const source = form.display_name || form.username || user.email || "MD";
  const initials = source
    .replace(/@.*/, "")
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
  return initials || "MD";
}

function profileAvatar(user: User) {
  const metadata = user.user_metadata as Record<string, unknown>;
  return asString(metadata.avatar_url) || asString(metadata.picture);
}

function asString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function profileIssue(message: string) {
  const normalized = message.toLowerCase();
  if (normalized.includes("relation") || normalized.includes("does not exist") || normalized.includes("schema cache")) {
    return "Run the latest supabase/schema.sql in Supabase SQL Editor to enable profile editing.";
  }
  if (normalized.includes("duplicate") || normalized.includes("profiles_username_lower_unique")) {
    return "That username is already taken.";
  }
  if (normalized.includes("row-level security") || normalized.includes("permission") || normalized.includes("policy")) {
    return "Supabase blocked the profile update. Re-run the profile RLS policies and make sure you are signed in.";
  }
  return message || "Profile could not be saved.";
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

function entryTitle(entry: JournalEntry) {
  if (entry.summary) return entry.summary.split(/[.!?]/)[0].slice(0, 42) || "Dream note";
  const content = entry.content.trim();
  if (!content) return "Untitled dream";
  return content.split(/[.!?]/)[0].slice(0, 42) || "Dream note";
}

function entryMatchesQuery(entry: JournalEntry, needle: string, visibleEntries: JournalEntry[]) {
  return entrySearchIndex(entry, visibleEntries).includes(needle);
}

function entrySearchIndex(entry: JournalEntry, visibleEntries: JournalEntry[]) {
  const date = new Date(`${entry.entry_date}T00:00:00`);
  const dateFormats = [
    entry.entry_date,
    longDate(entry.entry_date),
    new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(date),
    new Intl.DateTimeFormat(undefined, { month: "numeric", day: "numeric", year: "numeric" }).format(date),
    entryLabel(entry, visibleEntries),
  ];

  return [
    entryTitle(entry),
    entry.content,
    entry.summary || "",
    entry.mood || "",
    ...(entry.themes || []),
    ...dateFormats,
  ]
    .join(" ")
    .toLowerCase();
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
