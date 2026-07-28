import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Formats an ISO/UTC timestamp (as returned by the metrics API) as a short
 * time label in the viewer's local timezone, e.g. "14:00". Used for chart
 * X-axis ticks so bucket labels reflect the browser's timezone rather than
 * the server's.
 */
export function formatLocalTick(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

/**
 * Formats an ISO/UTC timestamp as a full local date + time for tooltips
 * and detail views, e.g. "Jul 28, 2026, 2:00 PM".
 */
export function formatLocalDateTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
