/**
 * All dates in the app should be anchored to Eastern Time (America/New_York).
 * This module provides helpers so every "today" or "now" calculation uses ET
 * regardless of the user's local timezone.
 */

const ET = "America/New_York";

/** Return a YYYY-MM-DD string for "today" in Eastern Time. */
export function etToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: ET,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/** Return a Date object whose local year/month/day match the current ET date.
 *  Useful when you need to do arithmetic (addBusinessDays, etc.). */
export function etNow(): Date {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: ET,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    hour12: false,
  }).formatToParts(new Date());
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return new Date(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
}
