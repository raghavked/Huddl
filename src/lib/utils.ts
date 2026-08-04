import { clsx, type ClassValue } from "clsx";

export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}

/** "3:42 PM" for today, "Tue 3:42 PM" this week, else "Jan 5". */
export function formatMessageTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) {
    return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }
  const weekAgo = new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000);
  if (d > weekAgo) {
    return d.toLocaleDateString([], {
      weekday: "short",
      hour: "numeric",
      minute: "2-digit",
    });
  }
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

export function formatEventTime(startIso: string, endIso?: string | null): string {
  const start = new Date(startIso);
  const datePart = start.toLocaleDateString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  const startTime = start.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
  if (!endIso) return `${datePart} · ${startTime}`;
  const end = new Date(endIso);
  const endTime = end.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
  return `${datePart} · ${startTime}–${endTime}`;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Initials for avatar fallbacks: "Ada Lovelace" -> "AL". */
export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}

/** Loose E.164 check used by the phone verification UI. */
export function isValidPhone(phone: string): boolean {
  return /^\+?[1-9]\d{7,14}$/.test(phone.replace(/[\s()-]/g, ""));
}

export function normalizePhone(phone: string): string {
  const digits = phone.replace(/[\s()-]/g, "");
  return digits.startsWith("+") ? digits : `+1${digits}`;
}
