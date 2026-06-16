import { Session, User } from "@supabase/supabase-js";
import {
  ArrowLeft,
  AtSign,
  BarChart3,
  BookOpen,
  Camera,
  Check,
  Cloud,
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
  ChevronDown,
  X as CloseIcon,
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent, ReactNode } from "react";
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

type AppNotification = {
  id: string;
  type: "dream_match" | "reflection_ready" | "memory_image" | "accepted_share" | "message" | "system";
  title: string;
  body: string;
  time: string;
  isRead: boolean;
  relatedMatchId: string | null;
  relatedEntryId: string | null;
};

type DbNotification = {
  id: string;
  type: AppNotification["type"];
  title: string;
  body: string | null;
  is_read: boolean;
  related_match_id: string | null;
  related_entry_id: string | null;
  created_at: string;
};

type DbCircleMessage = {
  id: string;
  circle_id: string;
  sender_id: string;
  content: string;
  created_at: string;
};

type LegalDocKey = "terms" | "privacy" | "cookies" | "ai" | "contact";

type LegalDocument = {
  title: string;
  updated: string;
  intro: string;
  sections: Array<{
    heading: string;
    body: string[];
  }>;
};

type ShareableDream = {
  id: string;
  date: string;
  excerpt: string;
  content: string;
  matchScore: number;
};

type ActiveDreamMatch = {
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
  yourDream: ShareableDream;
  theirDream: ShareableDream;
};

type CommandView = "archive" | "insights" | "analytics";

type SocialStage = "none" | "consent" | "share" | "chat";

type ChatMessage = {
  id: string;
  author: "you" | "other" | "system";
  body: string;
  time: string;
};

type LoadCircleMessagesOptions = {
  quiet?: boolean;
};

const legalDocuments: Record<LegalDocKey, LegalDocument> = {
  terms: {
    title: "Terms and Conditions",
    updated: "June 16, 2026",
    intro: "These Terms govern your access to MangDiary, a private journaling and dream-reflection app.",
    sections: [
      {
        heading: "Using MangDiary",
        body: [
          "You may use MangDiary to write journal entries and dreams, generate reflections, create memory images, upload a profile picture, receive dream-match notifications, and message users after both people choose to share.",
          "You are responsible for the entries, profile details, messages, and other content you add to your account.",
        ],
      },
      {
        heading: "Accounts and security",
        body: [
          "You can sign in with Google or with an email or username after setting a password. Keep your password private and tell us if you believe your account has been accessed without permission.",
          "We may suspend or limit accounts that misuse the service, attempt to access another user's data, abuse messaging, or interfere with the app.",
        ],
      },
      {
        heading: "AI reflections and dream matches",
        body: [
          "AI reflections, interpretations, image prompts, and dream matches are informational and creative features. They are not medical, psychological, legal, or professional advice.",
          "Dream matching is based on automated similarity signals. A match does not mean two users know each other, shared a real event, or should disclose private information.",
        ],
      },
      {
        heading: "User content",
        body: [
          "Your journal entries remain yours. You give MangDiary the limited permission needed to store, process, display, back up, analyze, and transmit your content so the app can work.",
          "Do not upload illegal content, content that violates another person's privacy or rights, or messages that harass, threaten, exploit, or impersonate others.",
        ],
      },
      {
        heading: "Availability and changes",
        body: [
          "MangDiary may change, pause, or discontinue features. We try to keep the app reliable, but we do not guarantee uninterrupted availability or error-free operation.",
          "We may update these Terms when the app changes. Continued use after an update means you accept the updated Terms.",
        ],
      },
    ],
  },
  privacy: {
    title: "Privacy Policy",
    updated: "June 16, 2026",
    intro: "This Privacy Policy explains how MangDiary handles account data, private journal content, AI processing, dream matching, profile data, and device data.",
    sections: [
      {
        heading: "Information we collect",
        body: [
          "Account information: email address, authentication provider, username, display name, password status, and profile details you choose to add.",
          "Journal information: dreams, daily entries, summaries, reflections, mood labels, themes, generated image prompts, memory images, and saved dates.",
          "Social information: dream-match records, match notifications, consent choices, shared dream references, anonymous sharing choices, and Dream Circle messages.",
          "Technical information: device/browser data needed for login, security, session persistence, app performance, and troubleshooting.",
        ],
      },
      {
        heading: "How we use information",
        body: [
          "We use your information to operate the journal, save entries, authenticate your account, generate reflections and images, find dream matches, send notifications, show your profile, and support messaging after mutual consent.",
          "We do not sell your journal entries or profile information. We do not use private dreams to advertise third-party products.",
        ],
      },
      {
        heading: "AI and service providers",
        body: [
          "MangDiary uses Supabase for authentication, database, storage, and server-side access controls.",
          "When you request reflections, image generation, or dream matching, relevant text or derived data may be sent to AI providers such as Gemini. OpenAI may remain configured as a fallback for embeddings if enabled by the operator.",
          "AI providers process the content needed to return the requested feature. Avoid entering content you do not want processed by these services.",
        ],
      },
      {
        heading: "Dream matching privacy",
        body: [
          "Dream matching runs server-side. Users do not see another user's raw dream text just because a match exists.",
          "A match notification invites both users to accept. Sharing and conversation happen only after the app's consent flow.",
        ],
      },
      {
        heading: "Your choices",
        body: [
          "You can edit or delete entries in the journal, update your profile, upload or replace your profile picture, turn off dream matching in profile settings, and sign out at any time.",
          "You can request access, correction, deletion, or other privacy help through the contact method listed in this app.",
        ],
      },
      {
        heading: "Children",
        body: [
          "MangDiary is not intended for children under 13. Do not use the app if you are under 13.",
          "If we learn that a child under 13 provided personal information, we will take steps to delete it where required.",
        ],
      },
    ],
  },
  cookies: {
    title: "Cookie and Local Storage Policy",
    updated: "June 16, 2026",
    intro: "MangDiary uses cookies and browser storage to keep the app signed in, save drafts, remember interface state, and support security.",
    sections: [
      {
        heading: "What we use",
        body: [
          "Authentication storage keeps you signed in through Supabase and supports session refresh.",
          "Local storage may temporarily keep unsaved drafts, preview content, the welcome-screen state, and a daily reflection run marker.",
          "Browser speech recognition is handled by the browser. MangDiary receives transcript text only when you use the microphone feature.",
        ],
      },
      {
        heading: "Analytics and advertising",
        body: [
          "MangDiary does not currently use advertising cookies or sell cookie-based behavioral profiles.",
          "If analytics or marketing tools are added later, this policy should be updated before those tools are enabled.",
        ],
      },
      {
        heading: "Managing storage",
        body: [
          "You can clear cookies and site data through your browser settings. Clearing storage may sign you out and remove local unsaved drafts.",
          "Some storage is necessary for login and app security, so the app may not work correctly if all cookies or local storage are blocked.",
        ],
      },
    ],
  },
  ai: {
    title: "AI and Wellness Notice",
    updated: "June 16, 2026",
    intro: "MangDiary uses AI to help reflect on dreams and journal entries. These features are supportive, not diagnostic.",
    sections: [
      {
        heading: "Not professional advice",
        body: [
          "AI reflections, symbols, themes, memory images, analytics, and dream matches are not medical care, mental health treatment, crisis support, legal advice, or financial advice.",
          "If you feel unsafe, distressed, or at risk of harming yourself or someone else, contact local emergency services or a qualified crisis support provider immediately.",
        ],
      },
      {
        heading: "How to read interpretations",
        body: [
          "Dream interpretations are creative readings based on the text you provide and may be incomplete, inaccurate, or emotionally wrong for you.",
          "Use reflections as prompts for your own thinking. You do not need to accept an interpretation that does not feel useful.",
        ],
      },
      {
        heading: "Dream matching caution",
        body: [
          "Dream matches are similarity suggestions, not proof of shared experience or personal compatibility.",
          "Share only what you are comfortable sharing and avoid revealing sensitive personal information to another user until you trust the conversation.",
        ],
      },
    ],
  },
  contact: {
    title: "Contact and Legal Requests",
    updated: "June 16, 2026",
    intro: "Use this notice for privacy, account, safety, and legal requests related to MangDiary.",
    sections: [
      {
        heading: "Privacy and account requests",
        body: [
          "For access, deletion, correction, account, or privacy questions, contact the MangDiary operator using the official support email or contact channel published for the service.",
          "Include the email or username on your account and the type of request you are making. Do not include your password.",
        ],
      },
      {
        heading: "Safety reports",
        body: [
          "If another user misuses Dream Circle messaging or pressures you to share private details, stop the conversation and report the issue through the available support channel.",
          "If there is immediate danger, contact local emergency services first.",
        ],
      },
      {
        heading: "Legal review",
        body: [
          "These documents are a product-specific starting point. If MangDiary is operated commercially or made available in multiple regions, have qualified legal counsel review them before relying on them as final legal terms.",
        ],
      },
    ],
  },
};

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
      <LegalFooter />
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
          <footer className="entry-actions">
            <div className="voice-control">
              <button
                className={speech.isListening ? "voice-button listening" : "voice-button"}
                type="button"
                onClick={speech.isListening ? speech.stop : speech.start}
                disabled={!speech.supported}
                aria-label={speech.isListening ? "Stop dictation" : "Start dictation"}
              >
                <Mic />
              </button>
              <div className={speech.transcript ? "live-transcript active" : "live-transcript"} aria-live="polite">
                {speech.transcript || " "}
              </div>
            </div>
            <SaveStatus state={saveState} />
          </footer>
          <ReflectionPanel insight={insight} state="idle" error="" onReflect={() => setInsight(localPreviewInsight(content))} />
        </section>
      </div>
      <LegalFooter />
    </main>
  );
}

function AuthScreen({ onStartedSignIn }: { onStartedSignIn: () => void }) {
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [loginIdentifier, setLoginIdentifier] = useState("");
  const [password, setPassword] = useState("");

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

  async function signInWithPassword() {
    const identifier = loginIdentifier.trim();
    if (!identifier || !password) {
      setError("Enter your email or username and password.");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const response = await fetch("/api/password-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier, password }),
      });
      const result = await readJsonResponse<{ session?: { access_token?: string; refresh_token?: string }; error?: string }>(response);
      if (!response.ok || result.error || !result.session?.access_token || !result.session.refresh_token) {
        throw new Error(result.error || "Invalid login credentials.");
      }

      const { error: sessionError } = await supabase.auth.setSession({
        access_token: result.session.access_token,
        refresh_token: result.session.refresh_token,
      });
      if (sessionError) throw sessionError;
      onStartedSignIn();
    } catch (authError) {
      setLoading(false);
      setError(authError instanceof Error ? authError.message : "Invalid login credentials.");
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
          <div className="email-login">
            <input
              value={loginIdentifier}
              onChange={(event) => setLoginIdentifier(event.target.value)}
              placeholder="Email or username"
              type="text"
              autoComplete="username"
            />
            <input
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Password"
              type="password"
              autoComplete="current-password"
              onKeyDown={(event) => {
                if (event.key === "Enter") void signInWithPassword();
              }}
            />
            <button type="button" onClick={signInWithPassword} disabled={loading}>
              {loading ? "Signing in..." : "Sign in"}
            </button>
          </div>
          <button className="google-button" type="button" onClick={signInWithGoogle} disabled={loading}>
            <span className="google-g">G</span>
            {loading ? "Opening Google..." : "Continue with Google"}
          </button>
          {error ? <span className="form-error">{error}</span> : null}
        </div>
        <small>Your entries are saved under your authenticated Supabase user ID.</small>
      </motion.section>
      <LegalFooter />
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
      <LegalFooter />
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
  const dailyReflectionRef = useRef("");
  const timelineGestureRef = useRef<{ id: string; x: number; y: number; longPressTimer: number | null } | null>(null);
  const suppressTimelineOpenRef = useRef("");
  const handledDateSelectionRef = useRef("");
  const openedInitialBlankRef = useRef(false);
  const lastAnalyzedRef = useRef("");
  const accessTokenRef = useRef("");
  const chatPollingRef = useRef(false);
  const notificationsPollingRef = useRef(false);
  const dreamMatchRunInFlightRef = useRef<Set<string>>(new Set());
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
  const [avatarState, setAvatarState] = useState<"idle" | "uploading" | "error">("idle");
  const [avatarError, setAvatarError] = useState("");
  const [passwordForm, setPasswordForm] = useState<PasswordForm>({ password: "", confirmPassword: "" });
  const [passwordState, setPasswordState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [passwordError, setPasswordError] = useState("");
  const [matchesOpen, setMatchesOpen] = useState(false);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [socialStage, setSocialStage] = useState<SocialStage>("none");
  const [shareAnonymously, setShareAnonymously] = useState(true);
  const [activeDreamMatch, setActiveDreamMatch] = useState<ActiveDreamMatch | null>(null);
  const [dreamMatchState, setDreamMatchState] = useState<"idle" | "loading" | "ready" | "empty" | "error">("idle");
  const [dreamMatchError, setDreamMatchError] = useState("");
  const [activeCircleId, setActiveCircleId] = useState<string | null>(null);
  const [circleState, setCircleState] = useState<"idle" | "opening" | "ready" | "error">("idle");
  const [circleError, setCircleError] = useState("");
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatDraft, setChatDraft] = useState("");

  useEffect(() => {
    const timer = window.setInterval(() => setAutoTheme(themeForTime()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    document.body.dataset.theme = theme;
  }, [theme]);

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

  const loadNotifications = useCallback(async () => {
    const { data, error } = await supabase
      .from("notifications")
      .select("id, type, title, body, is_read, related_match_id, related_entry_id, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(25)
      .returns<DbNotification[]>();

    if (error) {
      setNotifications([]);
      return;
    }

    setNotifications(dedupeNotifications((data || []).map(notificationFromDb)));
  }, [user.id]);

  useEffect(() => {
    void loadNotifications();
  }, [loadNotifications]);

  useEffect(() => {
    let stopped = false;
    const pollNotifications = async () => {
      if (stopped || notificationsPollingRef.current) return;
      notificationsPollingRef.current = true;
      try {
        await loadNotifications();
      } finally {
        notificationsPollingRef.current = false;
      }
    };

    const timer = window.setInterval(() => {
      void pollNotifications();
    }, 5000);

    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [loadNotifications]);

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
    if (!openedInitialBlankRef.current && selectedDate === today) {
      openedInitialBlankRef.current = true;
      window.setTimeout(() => editorRef.current?.focus(), 150);
      return;
    }
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
        if (!nextContent.trim()) {
          setSaveState("idle");
          return;
        }

        if (!quiet) setSaveState("saving");
        const { data, error } = await supabase
          .from("journal_entries")
          .insert({ user_id: user.id, entry_date: today, entry_index: await nextEntryIndex(today), content: nextContent })
          .select("*")
          .single();

        if (error) {
          setSaveState("error");
          setIssue(databaseIssue(error.message));
          return;
        }

        const createdEntry = data as JournalEntry;
        applyEntry(createdEntry);
        setSaveState("saved");
        setIssue(null);
        await loadEntries();
        void runDreamMatchForEntry(createdEntry.id, nextContent);
        return;
      }
      if (!quiet) setSaveState("saving");
      const shouldRunImmediateMatch = wordCount(entry.content) < 8 && wordCount(nextContent) >= 8;
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
      if (shouldRunImmediateMatch) void runDreamMatchForEntry(entry.id, nextContent);
    },
    [applyEntry, content, entry, loadEntries, today, user.id],
  );

  useEffect(() => {
    if (!entry) {
      if (!content.trim()) {
        setSaveState("idle");
        return;
      }
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
      setSaveState("saving");
      saveTimerRef.current = window.setTimeout(() => persist(content), 1200);
      return () => {
        if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
      };
    }
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
    const runKey = `mangdiary-daily-reflection-${user.id}-${today}`;
    if (dailyReflectionRef.current === runKey || localStorage.getItem(runKey) === "done") return;

    const previousEntry = entries.find(
      (item) => item.entry_date < today && item.content.trim().split(/\s+/).filter(Boolean).length >= 8 && !item.reflection,
    );

    if (!previousEntry) {
      dailyReflectionRef.current = runKey;
      localStorage.setItem(runKey, "done");
      return;
    }

    dailyReflectionRef.current = runKey;
    localStorage.setItem(runKey, "done");

    void (async () => {
      const selected = previousEntry.id === selectedEntryId;
      if (selected) {
        setInsightState("reflecting");
        setInsightError("");
      }

      try {
        const nextInsight = await analyzeEntry(previousEntry.content);
        if (!nextInsight) throw new Error("Reflection could not be generated.");
        const { data, error } = await supabase
          .from("journal_entries")
          .update({
            summary: nextInsight.summary,
            reflection: nextInsight.reflection,
            mood: nextInsight.mood,
            themes: nextInsight.themes,
            image_prompt: nextInsight.imagePrompt,
          })
          .eq("id", previousEntry.id)
          .eq("user_id", user.id)
          .select("*")
          .single();
        if (error) throw error;
        if (selected && data) {
          setEntry(data as JournalEntry);
          setInsight(nextInsight);
          setInsightState("idle");
          setIssue(null);
        }
        await loadEntries();
      } catch (error) {
        if (selected) {
          setInsightState("error");
          setInsightError(error instanceof Error ? error.message : "Reflection could not be generated.");
        }
      }
    })();
  }, [entries, loadEntries, selectedEntryId, today, user.id]);

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

  const selectedShareDream = activeDreamMatch?.yourDream;
  const matchedOtherDream = activeDreamMatch?.theirDream;
  const inboxItems = notifications;
  const unreadMatchCount = inboxItems.filter((item) => !item.isRead).length;
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

  async function markNotificationRead(id: string) {
    setNotifications((current) => current.map((item) => (item.id === id ? { ...item, isRead: true } : item)));
    await supabase.from("notifications").update({ is_read: true }).eq("id", id).eq("user_id", user.id);
    await loadNotifications();
  }

  async function markMatchNotificationsRead(matchId: string) {
    setNotifications((current) => current.map((item) => (item.relatedMatchId === matchId ? { ...item, isRead: true } : item)));
    await supabase
      .from("notifications")
      .update({ is_read: true })
      .eq("user_id", user.id)
      .eq("related_match_id", matchId);
    await loadNotifications();
  }

  async function runDreamMatchForEntry(entryId: string, savedContent: string) {
    if (wordCount(savedContent) < 8) return;
    if (dreamMatchRunInFlightRef.current.has(entryId)) return;
    dreamMatchRunInFlightRef.current.add(entryId);

    try {
      const { data } = await supabase.auth.getSession();
      const accessToken = data.session?.access_token || accessTokenRef.current;
      if (!accessToken) return;

      await fetch("/api/dream-match-run", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ entryId }),
      });
      await loadNotifications();
    } catch {
      return;
    } finally {
      dreamMatchRunInFlightRef.current.delete(entryId);
    }
  }

  async function loadDreamMatch(matchId: string | null): Promise<ActiveDreamMatch | null> {
    if (dreamMatchState === "loading") return activeDreamMatch;
    if (!matchId) {
      setDreamMatchState("empty");
      return null;
    }
    setDreamMatchState("loading");
    setDreamMatchError("");

    try {
      const { data } = await supabase.auth.getSession();
      const accessToken = data.session?.access_token || accessTokenRef.current;
      if (!accessToken) throw new Error("Sign in again to open this dream match.");

      const response = await fetch("/api/dream-match", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ matchId }),
      });
      const result = await readJsonResponse<{ match?: ActiveDreamMatch | null; error?: string }>(response);
      if (!response.ok || result.error) throw new Error(result.error || "Dream match could not be opened.");

      if (!result.match) {
        setActiveDreamMatch(null);
        setDreamMatchState("empty");
        await loadNotifications();
        return null;
      }

      const match = result.match;
      setActiveDreamMatch(match);
      setShareAnonymously(match.currentUserAnonymous);
      setDreamMatchState("ready");
      await loadNotifications();
      return match;
    } catch (error) {
      setDreamMatchState("error");
      setDreamMatchError(error instanceof Error ? error.message : "Dream match could not be opened.");
      await loadNotifications();
      return null;
    }
  }

  function openMatchesDrawer() {
    setMatchesOpen(true);
    setTimelineOpen(false);
    setProfileOpen(false);
    void loadNotifications();
  }

  async function openDreamMatchFlow(notificationId: string) {
    const notification = notifications.find((item) => item.id === notificationId);
    setMatchesOpen(false);
    setSocialStage("consent");
    const match = notification?.relatedMatchId === activeDreamMatch?.id ? activeDreamMatch : await loadDreamMatch(notification?.relatedMatchId || null);
    if (!match) {
      setDreamMatchState("empty");
      return;
    }
    void markNotificationRead(notificationId);
  }

  async function openMessageNotification(notificationId: string) {
    const notification = notifications.find((item) => item.id === notificationId);
    const match = notification?.relatedMatchId === activeDreamMatch?.id ? activeDreamMatch : await loadDreamMatch(notification?.relatedMatchId || null);
    if (!match) {
      setDreamMatchState("empty");
      return;
    }

    void markNotificationRead(notificationId);
    setMatchesOpen(false);
    await openDreamCircle(match);
  }

  function skipDreamMatch(notificationId: string) {
    void markNotificationRead(notificationId);
  }

  function openShareChoice() {
    if (!activeDreamMatch?.yourDream?.id) {
      setCircleState("error");
      setCircleError("This dream match could not load your dream entry. Please close it and try again.");
      setSocialStage("share");
      return;
    }

    setCircleState("idle");
    setCircleError("");
    setSocialStage("share");
  }

  async function loadCircleMessages(circleId: string, options: LoadCircleMessagesOptions = {}) {
    const { data, error } = await supabase
      .from("circle_messages")
      .select("id, circle_id, sender_id, content, created_at")
      .eq("circle_id", circleId)
      .order("created_at", { ascending: true })
      .limit(100)
      .returns<DbCircleMessage[]>();

    if (error) {
      if (!options.quiet) {
        setCircleState("error");
        setCircleError(error.message);
        setChatMessages([]);
      }
      return false;
    }

    const nextMessages = (data || []).map((message) => messageFromDb(message, user.id));
    if (options.quiet) {
      setChatMessages((currentMessages) => mergeCircleMessages(currentMessages, nextMessages));
    } else {
      setChatMessages(nextMessages);
    }
    if (!options.quiet) setCircleError("");
    return true;
  }

  useEffect(() => {
    if (socialStage !== "chat" || !activeCircleId) return;

    let stopped = false;
    const pollCircleMessages = async () => {
      if (stopped || chatPollingRef.current) return;
      chatPollingRef.current = true;
      try {
        await loadCircleMessages(activeCircleId, { quiet: true });
      } finally {
        chatPollingRef.current = false;
      }
    };

    void pollCircleMessages();
    const timer = window.setInterval(() => {
      void pollCircleMessages();
    }, 1000);

    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [activeCircleId, socialStage, user.id]);

  async function openDreamCircle(matchToOpen = activeDreamMatch) {
    if (!matchToOpen) return;
    setCircleState("opening");
    setCircleError("");

    try {
      if (!matchToOpen.yourDream?.id) {
        throw new Error("This match is missing your dream entry. Please close it and try from the latest match notification.");
      }

      const { data } = await supabase.auth.getSession();
      const accessToken = data.session?.access_token || accessTokenRef.current;
      if (!accessToken) throw new Error("Sign in again to open Dream Circle.");

      const response = await fetch("/api/dream-circle", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          action: "open",
          matchId: matchToOpen.id,
          entryId: matchToOpen.yourDream.id,
          anonymous: shareAnonymously,
        }),
      });
      const result = await readJsonResponse<{ circleId?: string; error?: string }>(response);
      if (!response.ok || !result.circleId || result.error) throw new Error(result.error || "Dream Circle could not open.");

      setActiveCircleId(result.circleId);
      await markMatchNotificationsRead(matchToOpen.id);
      await loadDreamMatch(matchToOpen.id);
      const messagesLoaded = await loadCircleMessages(result.circleId);
      if (!messagesLoaded) return;
      setCircleState("ready");
      setSocialStage("chat");
    } catch (error) {
      setCircleState("error");
      setCircleError(error instanceof Error ? error.message : "Dream Circle could not open.");
    }
  }

  async function sendChatMessage() {
    const nextMessage = chatDraft.trim();
    if (!nextMessage || !activeCircleId) return;
    setChatDraft("");

    try {
      const { data } = await supabase.auth.getSession();
      const accessToken = data.session?.access_token || accessTokenRef.current;
      if (!accessToken) throw new Error("Sign in again to send this message.");

      const response = await fetch("/api/dream-circle", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          action: "message",
          circleId: activeCircleId,
          content: nextMessage,
        }),
      });
      const result = await readJsonResponse<{ messageId?: string; error?: string }>(response);
      if (!response.ok || result.error) throw new Error(result.error || "Message could not be sent.");
    } catch (error) {
      setCircleState("error");
      setCircleError(error instanceof Error ? error.message : "Message could not be sent.");
      setChatDraft(nextMessage);
      return;
    }

    await loadCircleMessages(activeCircleId);
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

  async function openFreshTodayEntry() {
    if (content.trim() && (!entry || content !== entry.content)) await persist(content, true);
    handledDateSelectionRef.current = today;
    setEntry(null);
    setSelectedEntryId(null);
    setSelectedDate(today);
    setContent("");
    setInsight(emptyInsight);
    setSaveState("idle");
    setTimelineOpen(false);
    setIssue(null);
    window.setTimeout(() => editorRef.current?.focus(), 100);
  }

  async function createNewEntry() {
    if (content.trim() && (!entry || content !== entry.content)) await persist(content, true);
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
          avatar_url: nullableProfileValue(profileAvatar(user, profile)),
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
    setProfileOpen(false);
    window.setTimeout(() => setProfileState("idle"), 1400);
  }

  async function uploadProfileAvatar(file: File) {
    if (!file.type.startsWith("image/")) {
      setAvatarState("error");
      setAvatarError("Choose an image file.");
      return;
    }
    if (file.size > 4 * 1024 * 1024) {
      setAvatarState("error");
      setAvatarError("Profile image must be smaller than 4 MB.");
      return;
    }

    setAvatarState("uploading");
    setAvatarError("");

    try {
      const extension = avatarFileExtension(file);
      const path = `${user.id}/avatar-${Date.now()}.${extension}`;
      const { error: uploadError } = await supabase.storage.from("avatars").upload(path, file, {
        cacheControl: "3600",
        upsert: false,
      });
      if (uploadError) throw uploadError;

      const { data: publicData } = supabase.storage.from("avatars").getPublicUrl(path);
      const avatarUrl = publicData.publicUrl;
      const { data, error } = await supabase
        .from("profiles")
        .upsert(
          {
            id: user.id,
            username: nullableProfileValue(profileForm.username),
            display_name: nullableProfileValue(profileForm.display_name),
            avatar_url: avatarUrl,
            bio: nullableProfileValue(profileForm.bio),
            instagram_handle: nullableProfileValue(stripHandlePrefix(profileForm.instagram_handle)),
            tiktok_handle: nullableProfileValue(stripHandlePrefix(profileForm.tiktok_handle)),
            extra_links: buildExtraLinks(profileForm),
            matching_enabled: profileForm.matching_enabled,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "id" },
        )
        .select("*")
        .single();
      if (error) throw error;

      if (data) {
        const nextProfile = data as UserProfile;
        setProfile(nextProfile);
        setProfileForm(profileFormFromUser(user, nextProfile));
      }
      await supabase.auth.updateUser({ data: { avatar_url: avatarUrl, picture: avatarUrl } });
      setAvatarState("idle");
    } catch (error) {
      setAvatarState("error");
      setAvatarError(error instanceof Error ? profileIssue(error.message) : "Profile image could not be uploaded.");
    }
  }

  async function updateAccountPassword() {
    const nextPassword = passwordForm.password;
    if (nextPassword.length < 8) {
      setPasswordState("error");
      setPasswordError("Password must be at least 8 characters.");
      return;
    }
    if (nextPassword !== passwordForm.confirmPassword) {
      setPasswordState("error");
      setPasswordError("Passwords do not match.");
      return;
    }

    setPasswordState("saving");
    setPasswordError("");
    const { error } = await supabase.auth.updateUser({ password: nextPassword });
    if (error) {
      setPasswordState("error");
      setPasswordError(error.message);
      return;
    }

    setPasswordForm({ password: "", confirmPassword: "" });
    setPasswordState("saved");
    window.setTimeout(() => setPasswordState("idle"), 1800);
  }

  function closeFloatingPanels() {
    setTimelineOpen(false);
    setMatchesOpen(false);
    setProfileOpen(false);
  }

  return (
    <main className={`app-shell theme-${theme}`}>
      <div className="paper-grain" />

      <AnimatePresence>
        {matchesOpen ? (
          <OverlayLayer className="notification-overlay" onClose={() => setMatchesOpen(false)}>
            <DreamMatchesDrawer
              items={inboxItems}
              matchState={dreamMatchState}
              onClose={() => setMatchesOpen(false)}
              onOpenDreamMatch={openDreamMatchFlow}
              onOpenMessage={openMessageNotification}
              onSkipDreamMatch={skipDreamMatch}
              onReadNotification={markNotificationRead}
            />
          </OverlayLayer>
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {socialStage === "consent" ? (
          <MatchConsentOverlay
            loading={dreamMatchState === "loading"}
            onClose={() => setSocialStage("none")}
            onAccept={openShareChoice}
            onDecline={() => setSocialStage("none")}
          />
        ) : null}
        {socialStage === "share" ? (
          <ShareDreamOverlay
            dream={selectedShareDream}
            anonymous={shareAnonymously}
            state={circleState}
            error={circleError}
            onBack={() => setSocialStage("consent")}
            onClose={() => setSocialStage("none")}
            onAnonymousChange={setShareAnonymously}
            onShare={() => openDreamCircle()}
          />
        ) : null}
        {socialStage === "chat" ? (
          <DreamCircleChat
            yourDream={selectedShareDream}
            theirDream={matchedOtherDream}
            currentUserAnonymous={activeDreamMatch?.currentUserAnonymous ?? shareAnonymously}
            otherUserAnonymous={activeDreamMatch?.otherUserAnonymous ?? true}
            messages={chatMessages}
            draft={chatDraft}
            currentUserName={profileForm.display_name || profileForm.username || user.email?.split("@")[0] || "You"}
            currentUserAvatar={profileAvatar(user, profile)}
            currentUserInitials={profileInitials(user, profileForm)}
            otherUserName={activeDreamMatch?.otherProfile.displayName || "Matched dreamer"}
            otherUserAvatar={activeDreamMatch?.otherProfile.avatarUrl || ""}
            state={circleState}
            error={circleError}
            onBack={() => setSocialStage("none")}
            onDraftChange={setChatDraft}
            onSend={sendChatMessage}
          />
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {timelineOpen ? (
          <OverlayLayer className="command-overlay" onClose={() => setTimelineOpen(false)}>
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
                    setTimelineOpen(false);
                    setMatchesOpen(false);
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
          </OverlayLayer>
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {profileOpen ? (
          <OverlayLayer className="profile-overlay" onClose={() => setProfileOpen(false)}>
            <ProfilePanel
              user={user}
              profile={profile}
              form={profileForm}
              state={profileState}
              error={profileError}
              avatarState={avatarState}
              avatarError={avatarError}
              passwordForm={passwordForm}
              passwordState={passwordState}
              passwordError={passwordError}
              onChange={setProfileForm}
              onSave={saveProfile}
              onAvatarUpload={(file) => void uploadProfileAvatar(file)}
              onPasswordChange={setPasswordForm}
              onPasswordSave={() => void updateAccountPassword()}
              onClose={() => setProfileOpen(false)}
              onSignOut={() => supabase.auth.signOut()}
            />
          </OverlayLayer>
        ) : null}
      </AnimatePresence>

      <div className="journal-layout">
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
              <div className={speech.transcript ? "live-transcript active" : "live-transcript"} aria-live="polite">
                {speech.transcript || " "}
              </div>
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
          <LegalFooter />
        </section>
      </div>
      <BottomNav
        onHome={() => {
          closeFloatingPanels();
          void openFreshTodayEntry();
        }}
        onJournal={() => {
          setTimelineOpen(true);
          setProfileOpen(false);
          setMatchesOpen(false);
        }}
        onMatches={() => {
          openMatchesDrawer();
        }}
        onProfile={() => {
          setProfileOpen(true);
          setTimelineOpen(false);
          setMatchesOpen(false);
        }}
        profileAvatarUrl={profileAvatar(user, profile)}
        unreadMatchCount={unreadMatchCount}
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

function LegalFooter() {
  const [openDoc, setOpenDoc] = useState<LegalDocKey | null>(null);
  const links: Array<{ key: LegalDocKey; label: string }> = [
    { key: "terms", label: "Terms" },
    { key: "privacy", label: "Privacy" },
    { key: "cookies", label: "Cookies" },
    { key: "ai", label: "AI Notice" },
    { key: "contact", label: "Contact" },
  ];

  return (
    <>
      <footer className="legal-footer" aria-label="Legal links">
        {links.map((link) => (
          <button key={link.key} type="button" onClick={() => setOpenDoc(link.key)}>
            {link.label}
          </button>
        ))}
      </footer>
      <AnimatePresence>
        {openDoc ? <LegalDocumentOverlay documentKey={openDoc} onClose={() => setOpenDoc(null)} /> : null}
      </AnimatePresence>
    </>
  );
}

function LegalDocumentOverlay({ documentKey, onClose }: { documentKey: LegalDocKey; onClose: () => void }) {
  const document = legalDocuments[documentKey];

  return (
    <OverlayLayer className="legal-overlay" onClose={onClose}>
      <motion.article
        className="legal-panel"
        initial={{ opacity: 0, y: 18, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 18, scale: 0.98 }}
        transition={{ duration: 0.2 }}
        aria-label={document.title}
      >
        <div className="legal-panel-head">
          <div>
            <span>MangDiary</span>
            <h2>{document.title}</h2>
            <small>Effective {document.updated}</small>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close legal document">
            <CloseIcon />
          </button>
        </div>
        <p className="legal-intro">{document.intro}</p>
        <div className="legal-sections">
          {document.sections.map((section) => (
            <section key={section.heading}>
              <h3>{section.heading}</h3>
              {section.body.map((paragraph) => (
                <p key={paragraph}>{paragraph}</p>
              ))}
            </section>
          ))}
        </div>
      </motion.article>
    </OverlayLayer>
  );
}

function OverlayLayer({
  children,
  className,
  onClose,
}: {
  children: ReactNode;
  className: string;
  onClose: () => void;
}) {
  return (
    <motion.div
      className={`overlay-layer ${className}`}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.16 }}
    >
      <button className="overlay-backdrop" type="button" onClick={onClose} aria-label="Close overlay" />
      <div className="overlay-content" onClick={(event) => event.stopPropagation()}>
        {children}
      </div>
    </motion.div>
  );
}

function BottomNav({
  onHome,
  onJournal,
  onMatches,
  onProfile,
  profileAvatarUrl,
  unreadMatchCount,
}: {
  onHome: () => void;
  onJournal: () => void;
  onMatches: () => void;
  onProfile: () => void;
  profileAvatarUrl: string;
  unreadMatchCount: number;
}) {
  return (
    <nav className="bottom-nav" aria-label="Primary navigation">
      <button type="button" onClick={onHome} aria-label="Home" title="Home">
        <Home />
      </button>
      <button type="button" onClick={onJournal} aria-label="Journal" title="Journal">
        <PenLine />
      </button>
      <button type="button" onClick={onMatches} aria-label="Matches" title="Matches">
        <Heart />
        {unreadMatchCount > 0 ? <span className="nav-badge">{unreadMatchCount > 9 ? "9+" : unreadMatchCount}</span> : null}
      </button>
      <button type="button" onClick={onProfile} aria-label="Profile" title="Profile">
        {profileAvatarUrl ? <img className="bottom-nav-avatar" src={profileAvatarUrl} alt="" /> : <UserRound />}
      </button>
    </nav>
  );
}

function DreamMatchesDrawer({
  items,
  matchState,
  onClose,
  onOpenDreamMatch,
  onOpenMessage,
  onSkipDreamMatch,
  onReadNotification,
}: {
  items: AppNotification[];
  matchState: "idle" | "loading" | "ready" | "empty" | "error";
  onClose: () => void;
  onOpenDreamMatch: (id: string) => void;
  onOpenMessage: (id: string) => void;
  onSkipDreamMatch: (id: string) => void;
  onReadNotification: (id: string) => void;
}) {
  const matchItems = items.filter((item) => item.type === "dream_match");
  const whisperItems = items.filter((item) => item.type === "message");
  const [activeFilter, setActiveFilter] = useState<"matches" | "whispers">("matches");
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null);
  const selectedFilterRef = useRef(false);
  const filteredItems = activeFilter === "matches" ? matchItems : whisperItems;

  useEffect(() => {
    if (selectedFilterRef.current) return;
    if (matchItems.length === 0 && whisperItems.length > 0) setActiveFilter("whispers");
  }, [matchItems.length, whisperItems.length]);

  const selectFilter = (filter: "matches" | "whispers") => {
    selectedFilterRef.current = true;
    setActiveFilter(filter);
  };

  const openItem = (item: AppNotification) => {
    if (item.type === "dream_match") {
      onOpenDreamMatch(item.id);
      return;
    }
    if (item.type === "message") {
      onOpenMessage(item.id);
      return;
    }
    onReadNotification(item.id);
  };

  const toggleItem = (id: string) => {
    setExpandedItemId((current) => (current === id ? null : id));
  };

  const renderNotificationItem = (item: AppNotification) => {
    const expanded = expandedItemId === item.id;
    if (item.type === "dream_match") {
      return (
        <article className={item.isRead ? "notification-item match-card" : "notification-item match-card unread"} key={item.id}>
          <button className="notification-item-header" type="button" aria-expanded={expanded} onClick={() => toggleItem(item.id)}>
            <div className="match-card-top">
              <div className="match-avatar-pair" aria-hidden="true">
                <span>U</span>
                <span>?</span>
              </div>
              <div className="match-card-title">
                <span>Dream match found</span>
                <strong>Unknown dreamer</strong>
              </div>
              <span className="match-score">{matchBadgeLabel(item.body)}</span>
            </div>
            <div className="notification-item-header-meta">
              <small>{item.time}</small>
              <span className="notification-item-chevron" aria-hidden="true">
                <ChevronDown />
              </span>
            </div>
          </button>

          {expanded ? (
            <div className="notification-item-details">
              <button className="match-card-body" type="button" onClick={() => openItem(item)}>
                <span>{item.body}</span>
              </button>

              <div className="match-preview-grid">
                <div>
                  <span>Your dream</span>
                  <p>{matchPreviewSummary(item.body)}</p>
                </div>
                <div>
                  <span>Their dream</span>
                  <p>Hidden until you both agree to share with each other.</p>
                </div>
              </div>

              <div className="notification-actions">
                <button type="button" onClick={() => onSkipDreamMatch(item.id)}>Skip</button>
                <button type="button" onClick={() => onOpenDreamMatch(item.id)}>Explore connection</button>
              </div>
            </div>
          ) : null}
        </article>
      );
    }

    return (
      <article className={item.isRead ? "notification-item whisper-card" : "notification-item whisper-card unread"} key={item.id}>
        <button className="notification-item-header" type="button" aria-expanded={expanded} onClick={() => toggleItem(item.id)}>
          <div className="whisper-card-top">
            <div className="notification-icon">{notificationIcon(item.type)}</div>
            <div>
              <span>{item.type === "message" ? "New whisper" : "Update"}</span>
              <strong>{item.title}</strong>
            </div>
          </div>
          <div className="notification-item-header-meta">
            <small>{item.time}</small>
            <span className="notification-item-chevron" aria-hidden="true">
              <ChevronDown />
            </span>
          </div>
        </button>
        {expanded ? (
          <div className="notification-item-details">
            <button className="notification-copy" type="button" onClick={() => openItem(item)}>
              <span>{item.body}</span>
            </button>
            <div className="notification-actions single">
              <button type="button" onClick={() => openItem(item)}>Open whisper</button>
            </div>
          </div>
        ) : null}
      </article>
    );
  };

  return (
    <motion.aside
      className="notification-drawer"
      initial={{ opacity: 0, x: 28 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 28 }}
      transition={{ duration: 0.22 }}
      aria-label="Dream matches"
    >
      <div className="notification-head">
        <h2>Matches</h2>
        <button className="icon-button" type="button" onClick={onClose} aria-label="Close matches">
          <CloseIcon />
        </button>
      </div>

      <div className="notification-filters" role="tablist" aria-label="Matches filters">
        <button
          className={activeFilter === "matches" ? "active" : ""}
          type="button"
          role="tab"
          aria-selected={activeFilter === "matches"}
          onClick={() => selectFilter("matches")}
        >
          <Sparkles />
          <span>Matches</span>
          <strong>{matchItems.length}</strong>
        </button>
        <button
          className={activeFilter === "whispers" ? "active" : ""}
          type="button"
          role="tab"
          aria-selected={activeFilter === "whispers"}
          onClick={() => selectFilter("whispers")}
        >
          <MessageCircle />
          <span>Whispers</span>
          <strong>{whisperItems.length}</strong>
        </button>
      </div>

      {matchState === "loading" && activeFilter === "matches" ? <p className="notification-status">Opening dream match...</p> : null}
      {filteredItems.length === 0 && !(matchState === "loading" && activeFilter === "matches") ? (
        <p className="notification-status">
          {activeFilter === "matches"
            ? "If a dream matches overnight, it will show here."
            : "When someone sends a message in Dream Circle, it will show here."}
        </p>
      ) : null}
      <div className="notification-list">
        {filteredItems.map(renderNotificationItem)}
      </div>
    </motion.aside>
  );
}

function MatchConsentOverlay({
  loading,
  onClose,
  onAccept,
  onDecline,
}: {
  loading: boolean;
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
        <button className="social-primary" type="button" onClick={onAccept} disabled={loading}>
          {loading ? "Loading match..." : "Yes, I am curious"}
        </button>
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
  state,
  error,
  onBack,
  onClose,
  onAnonymousChange,
  onShare,
}: {
  dream?: ShareableDream;
  anonymous: boolean;
  state: "idle" | "opening" | "ready" | "error";
  error: string;
  onBack: () => void;
  onClose: () => void;
  onAnonymousChange: (value: boolean) => void;
  onShare: () => void;
}) {
  const opening = state === "opening";

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
        {error ? <p className="social-error">{error}</p> : null}
        <button className="social-primary" type="button" onClick={onShare} disabled={!dream || opening}>
          {opening ? "Opening..." : "Share this dream"}
        </button>
        <small>You can revoke access later from your Dream Circle.</small>
      </div>
    </motion.section>
  );
}

function DreamCircleChat({
  yourDream,
  theirDream,
  currentUserAnonymous,
  otherUserAnonymous,
  messages,
  draft,
  currentUserName,
  currentUserAvatar,
  currentUserInitials,
  otherUserName,
  otherUserAvatar,
  state,
  error,
  onBack,
  onDraftChange,
  onSend,
}: {
  yourDream?: ShareableDream;
  theirDream?: ShareableDream;
  currentUserAnonymous: boolean;
  otherUserAnonymous: boolean;
  messages: ChatMessage[];
  draft: string;
  currentUserName: string;
  currentUserAvatar: string;
  currentUserInitials: string;
  otherUserName: string;
  otherUserAvatar: string;
  state: "idle" | "opening" | "ready" | "error";
  error: string;
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
          <PinnedDreamCard label={currentUserAnonymous ? "Anonymous" : "Your dream"} dream={yourDream} />
          <PinnedDreamCard label={otherUserAnonymous ? "Anonymous dreamer" : "Other dreamer"} dream={theirDream} />
        </div>
      </section>

      <div className="chat-stream">
        <span className="chat-day">Messages</span>
        {state === "error" && error ? <p className="social-error">{error}</p> : null}
        {messages.length === 0 && state !== "error" ? <p className="chat-empty">No messages yet.</p> : null}
        {messages.map((message) => {
          const sender = chatSenderFor(message.author, {
            currentUserAnonymous,
            otherUserAnonymous,
            currentUserName,
            currentUserAvatar,
            currentUserInitials,
            otherUserName,
            otherUserAvatar,
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
    currentUserAnonymous: boolean;
    otherUserAnonymous: boolean;
    currentUserName: string;
    currentUserAvatar: string;
    currentUserInitials: string;
    otherUserName: string;
    otherUserAvatar: string;
  },
) {
  if (author === "you") {
    return {
      name: context.currentUserAnonymous ? "Anonymous" : context.currentUserName,
      avatarUrl: context.currentUserAnonymous ? "" : context.currentUserAvatar,
      initials: context.currentUserAnonymous ? "AN" : context.currentUserInitials,
    };
  }

  if (author === "other") {
    return {
      name: context.otherUserAnonymous ? "Anonymous" : context.otherUserName,
      avatarUrl: context.otherUserAnonymous ? "" : context.otherUserAvatar,
      initials: context.otherUserAnonymous ? "AN" : initialsForName(context.otherUserName, "MD"),
    };
  }

  return {
    name: "Dream Circle",
    avatarUrl: "",
    initials: "DC",
  };
}

function notificationFromDb(item: DbNotification): AppNotification {
  return {
    id: item.id,
    type: item.type,
    title: item.title,
    body: item.body || "",
    time: relativeTimeLabel(item.created_at),
    isRead: item.is_read,
    relatedMatchId: item.related_match_id,
    relatedEntryId: item.related_entry_id,
  };
}

function dedupeNotifications(items: AppNotification[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = item.relatedMatchId && (item.type === "dream_match" || item.type === "accepted_share" || item.type === "message")
      ? `${item.type}:${item.relatedMatchId}`
      : `${item.type}:${item.relatedEntryId || item.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function messageFromDb(item: DbCircleMessage, userId: string): ChatMessage {
  return {
    id: item.id,
    author: item.sender_id === userId ? "you" : "other",
    body: item.content,
    time: relativeTimeLabel(item.created_at),
  };
}

function mergeCircleMessages(currentMessages: ChatMessage[], nextMessages: ChatMessage[]) {
  if (currentMessages.length > nextMessages.length) {
    const nextIds = new Set(nextMessages.map((message) => message.id));
    const hasLocalMessagesMissingFromSnapshot = currentMessages.some((message) => !nextIds.has(message.id));
    if (hasLocalMessagesMissingFromSnapshot) return currentMessages;
  }

  if (
    currentMessages.length === nextMessages.length &&
    currentMessages.every((message, index) => {
      const nextMessage = nextMessages[index];
      return nextMessage && message.id === nextMessage.id && message.body === nextMessage.body && message.time === nextMessage.time;
    })
  ) {
    return currentMessages;
  }

  return nextMessages;
}

function relativeTimeLabel(value: string) {
  const createdAt = new Date(value).getTime();
  const diffMs = Date.now() - createdAt;
  if (!Number.isFinite(diffMs) || diffMs < 0) return editedDateTime(value, false);
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diffMs < minute) return "Now";
  if (diffMs < hour) return `${Math.floor(diffMs / minute)} min ago`;
  if (diffMs < day) return `${Math.floor(diffMs / hour)} hr ago`;
  if (diffMs < 2 * day) return "Yesterday";
  if (diffMs < 7 * day) return `${Math.floor(diffMs / day)} days ago`;
  return editedDateTime(value, false);
}

function notificationIcon(type: AppNotification["type"]) {
  if (type === "dream_match") return <Sparkles />;
  if (type === "reflection_ready") return <Star />;
  if (type === "memory_image") return <Image />;
  if (type === "accepted_share") return <Heart />;
  if (type === "message") return <MessageCircle />;
  return <Info />;
}

function matchBadgeLabel(body: string) {
  const normalized = body.toLowerCase();
  if (normalized.includes("same dreamscape")) return "Strong match";
  if (normalized.includes("dreaming in parallel")) return "Close match";
  if (normalized.includes("faint echo")) return "Soft match";
  return "Match";
}

function matchPreviewSummary(body: string) {
  const normalized = body.toLowerCase();
  if (normalized.includes("same dreamscape")) return "A recent dream of yours carries a strong shared atmosphere with another dreamer.";
  if (normalized.includes("dreaming in parallel")) return "A recent dream of yours is moving in parallel with another dreamer's symbols and feeling.";
  if (normalized.includes("faint echo")) return "A recent dream of yours is sending a softer echo that may still be meaningful.";
  return "One of your recent dreams is resonating with another dreamer.";
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

type PasswordForm = {
  password: string;
  confirmPassword: string;
};

function ProfilePanel({
  user,
  profile,
  form,
  state,
  error,
  avatarState,
  avatarError,
  passwordForm,
  passwordState,
  passwordError,
  onChange,
  onSave,
  onAvatarUpload,
  onPasswordChange,
  onPasswordSave,
  onClose,
  onSignOut,
}: {
  user: User;
  profile: UserProfile | null;
  form: ProfileForm;
  state: "idle" | "loading" | "saving" | "saved" | "error";
  error: string;
  avatarState: "idle" | "uploading" | "error";
  avatarError: string;
  passwordForm: PasswordForm;
  passwordState: "idle" | "saving" | "saved" | "error";
  passwordError: string;
  onChange: (form: ProfileForm) => void;
  onSave: () => void;
  onAvatarUpload: (file: File) => void;
  onPasswordChange: (form: PasswordForm) => void;
  onPasswordSave: () => void;
  onClose: () => void;
  onSignOut: () => void;
}) {
  const avatarUrl = profileAvatar(user, profile);
  const initials = profileInitials(user, form);
  const statusText =
    state === "loading" ? "Loading profile..." : state === "saving" ? "Saving..." : state === "saved" ? "Saved" : "";

  function update<K extends keyof ProfileForm>(key: K, value: ProfileForm[K]) {
    onChange({ ...form, [key]: value });
  }

  function updatePassword<K extends keyof PasswordForm>(key: K, value: PasswordForm[K]) {
    onPasswordChange({ ...passwordForm, [key]: value });
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
          <label className="avatar-upload-button">
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) onAvatarUpload(file);
              }}
              disabled={avatarState === "uploading"}
            />
            {avatarState === "uploading" ? "Uploading photo..." : "Change photo"}
          </label>
        </div>
        <button className="profile-close" type="button" onClick={onClose} aria-label="Close profile">
          <CloseIcon size={17} />
        </button>
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
      {avatarState === "error" ? <p className="profile-error">{avatarError}</p> : null}
      {profile?.updated_at ? <small className="profile-updated">Last saved {editedDateTime(profile.updated_at, false)}</small> : null}

      <section className="account-security">
        <div>
          <h3>Account Password</h3>
          <p>Set a password for this email so you can sign in without Google next time.</p>
        </div>
        <div className="profile-grid">
          <label className="profile-field">
            <span>New password</span>
            <input
              value={passwordForm.password}
              onChange={(event) => updatePassword("password", event.target.value)}
              type="password"
              placeholder="At least 8 characters"
              autoComplete="new-password"
            />
          </label>
          <label className="profile-field">
            <span>Confirm password</span>
            <input
              value={passwordForm.confirmPassword}
              onChange={(event) => updatePassword("confirmPassword", event.target.value)}
              type="password"
              placeholder="Repeat password"
              autoComplete="new-password"
            />
          </label>
        </div>
        {passwordState === "error" ? <p className="profile-error">{passwordError}</p> : null}
        {passwordState === "saved" ? <p className="profile-success">Password updated. You can sign in with this email and password.</p> : null}
        <button className="password-save-button" type="button" onClick={onPasswordSave} disabled={passwordState === "saving"}>
          {passwordState === "saving" ? "Updating..." : "Set Password"}
        </button>
      </section>

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

async function readJsonResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  try {
    return (text ? JSON.parse(text) : {}) as T;
  } catch {
    throw new Error(text.trim() || "Server returned an invalid response.");
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

function initialsForName(value: string, fallback: string) {
  const initials = value
    .replace(/@.*/, "")
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
  return initials || fallback;
}

function profileInitials(user: User, form: ProfileForm) {
  const source = form.display_name || form.username || user.email || "MD";
  return initialsForName(source, "MD");
}

function avatarFileExtension(file: File) {
  const fromName = file.name.split(".").pop()?.toLowerCase();
  if (fromName && ["png", "jpg", "jpeg", "webp", "gif"].includes(fromName)) return fromName === "jpeg" ? "jpg" : fromName;
  if (file.type.includes("png")) return "png";
  if (file.type.includes("webp")) return "webp";
  if (file.type.includes("gif")) return "gif";
  return "jpg";
}

function profileAvatar(user: User, profile?: UserProfile | null) {
  if (profile?.avatar_url) return profile.avatar_url;
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
