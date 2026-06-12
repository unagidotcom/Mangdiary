import type { ThemeName } from "../types";

export function isoToday(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function longDate(value: string | Date) {
  const date = typeof value === "string" ? new Date(`${value}T12:00:00`) : value;
  return new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

export function shortDate(value: string) {
  const today = isoToday();
  const date = new Date(`${value}T12:00:00`);
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);

  if (value === today) return "Today";
  if (value === isoToday(yesterday)) return "Yesterday";

  return new Intl.DateTimeFormat(undefined, { month: "long", day: "numeric" }).format(date);
}

export function savedDateTime(value: string | Date) {
  const date = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export function greeting(date = new Date()) {
  const hour = date.getHours();
  if (hour >= 5 && hour < 10) return "Good Morning";
  if (hour >= 10 && hour < 17) return "Good Afternoon";
  if (hour >= 17 && hour < 20) return "Good Evening";
  return "Good Night";
}

export function themeForTime(date = new Date()): ThemeName {
  const hour = date.getHours();
  if (hour >= 5 && hour < 10) return "morning";
  if (hour >= 10 && hour < 17) return "day";
  if (hour >= 17 && hour < 20) return "evening";
  return "night";
}

export function dateMonthsAgo(months: number) {
  const date = new Date();
  date.setMonth(date.getMonth() - months);
  return isoToday(date);
}

export function dateYearsAgo(years: number) {
  const date = new Date();
  date.setFullYear(date.getFullYear() - years);
  return isoToday(date);
}
