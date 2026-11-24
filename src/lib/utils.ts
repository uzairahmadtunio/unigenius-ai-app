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
