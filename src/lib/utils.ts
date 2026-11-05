import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

// ---------------------------------------------------------------------------
// Dates. All formatting is done with a fixed locale so server-rendered and
// client-rendered output match and React does not report a hydration mismatch.
// ---------------------------------------------------------------------------

const LOCALE = 'en-US';

export function formatDate(value: Date | string | null | undefined): string {
  if (!value) return '—';
  const d = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(LOCALE, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function formatDateLong(value: Date | string | null | undefined): string {
  if (!value) return '—';
  const d = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(LOCALE, {
    weekday: 'short',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

export function formatDateTime(value: Date | string | null | undefined): string {
  if (!value) return '—';
  const d = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return '—';
  return `${d.toLocaleDateString(LOCALE, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })}, ${d.toLocaleTimeString(LOCALE, { hour: 'numeric', minute: '2-digit' })}`;
}

export function toDateInputValue(value: Date | string | null | undefined): string {
  if (!value) return '';
  const d = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function daysUntil(value: Date | string | null | undefined, now = new Date()): number | null {
  if (!value) return null;
  const d = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return null;
  return Math.ceil((d.getTime() - now.getTime()) / 86_400_000);
}

export function isOverdue(value: Date | string | null | undefined, now = new Date()): boolean {
  const days = daysUntil(value, now);
  return days !== null && days < 0;
}

/** "in 3 days", "2 days ago", "today". */
export function relativeDueLabel(value: Date | string | null | undefined, now = new Date()): string {
  const days = daysUntil(value, now);
  if (days === null) return 'No due date';
  if (days === 0) return 'Due today';
  if (days === 1) return 'Due tomorrow';
  if (days === -1) return 'Overdue by 1 day';
  if (days < 0) return `Overdue by ${Math.abs(days)} days`;
  return `Due in ${days} days`;
}

export function formatRelativeTime(value: Date | string | null | undefined, now = new Date()): string {
  if (!value) return '—';
  const d = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return '—';
  const seconds = Math.round((now.getTime() - d.getTime()) / 1000);
  if (seconds < 45) return 'just now';
  if (seconds < 90) return 'a minute ago';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minutes ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return hours === 1 ? 'an hour ago' : `${hours} hours ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return days === 1 ? 'yesterday' : `${days} days ago`;
  return formatDate(d);
}

// ---------------------------------------------------------------------------
// Numbers / text
// ---------------------------------------------------------------------------

export function formatPercent(value: number | null | undefined, places = 0): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return `${value.toFixed(places)}%`;
}

export function formatScore(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'Not scored';
  return value.toFixed(1);
}

export function pluralize(count: number, singular: string, plural?: string): string {
  return count === 1 ? singular : (plural ?? `${singular}s`);
}

export function countLabel(count: number, singular: string, plural?: string): string {
  return `${count} ${pluralize(count, singular, plural)}`;
}

export function initials(first: string, last: string): string {
  return `${(first[0] ?? '').toUpperCase()}${(last[0] ?? '').toUpperCase()}`;
}

export function fullName(p: {
  firstName: string;
  lastName: string;
  preferredName?: string | null;
}): string {
  return `${p.preferredName || p.firstName} ${p.lastName}`;
}

export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

/** Deterministic palette index so a person's avatar colour never changes. */
export function colorFromString(value: string): number {
  let h = 0;
  for (let i = 0; i < value.length; i += 1) {
    h = (h * 31 + value.charCodeAt(i)) >>> 0;
  }
  return h % 8;
}

export const AVATAR_PALETTE = [
  'bg-sky-100 text-sky-800',
  'bg-amber-100 text-amber-800',
  'bg-emerald-100 text-emerald-800',
  'bg-violet-100 text-violet-800',
  'bg-rose-100 text-rose-800',
  'bg-teal-100 text-teal-800',
  'bg-indigo-100 text-indigo-800',
  'bg-orange-100 text-orange-800',
] as const;

export function parseJsonArray(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export function safeJsonParse<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

/** Converts "#1d4e89" to "29 78 137" for use in a Tailwind rgb(var(--x)) token. */
export function hexToRgbTriplet(hex: string): string | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const int = parseInt(m[1] as string, 16);
  return `${(int >> 16) & 255} ${(int >> 8) & 255} ${int & 255}`;
}

/** Lighter/darker variants of a brand colour, for the generated CSS palette. */
export function mixWithWhite(hex: string, amount: number): string | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const int = parseInt(m[1] as string, 16);
  const mix = (channel: number) => Math.round(channel + (255 - channel) * amount);
  return `${mix((int >> 16) & 255)} ${mix((int >> 8) & 255)} ${mix(int & 255)}`;
}

export function mixWithBlack(hex: string, amount: number): string | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const int = parseInt(m[1] as string, 16);
  const mix = (channel: number) => Math.round(channel * (1 - amount));
  return `${mix((int >> 16) & 255)} ${mix((int >> 8) & 255)} ${mix(int & 255)}`;
}
