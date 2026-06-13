export type ThemeName = "morning" | "day" | "evening" | "night";

export type JournalEntry = {
  id: string;
  user_id: string;
  content: string;
  summary: string | null;
  reflection: string | null;
  mood: string | null;
  themes: string[];
  image_url: string | null;
  image_prompt: string | null;
  entry_date: string;
  entry_index: number;
  created_at: string;
  updated_at: string;
};

export type UserProfile = {
  id: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
  bio: string | null;
  instagram_handle: string | null;
  tiktok_handle: string | null;
  extra_links: Record<string, string> | null;
  matching_enabled: boolean;
  created_at: string;
  updated_at: string;
};

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

export type SaveState = "idle" | "saving" | "saved" | "error";

export type AppIssue = {
  title: string;
  detail: string;
};
