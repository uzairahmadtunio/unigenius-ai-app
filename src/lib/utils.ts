import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * The ONE way quiz percentages are calculated anywhere in the app
 * (scorecard, profile, history): standard rounding of score/total.
 * (The leaderboard RPC applies the same ROUND() in SQL.)
 */
export function quizPercent(score: number, total: number): number {
  if (!total || total <= 0) return 0;
  return Math.round((score / total) * 100);
}

/**
 * Human-readable file size. Sub-1 KB files must show real bytes —
 * the old `(size / 1024).toFixed(0) + " KB"` rendered a 328-byte CV
 * as "0 KB" (D-10).
 */
export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
