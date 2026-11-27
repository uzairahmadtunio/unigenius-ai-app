// Phase 4 — platform settings (feature switches + maintenance mode).
// Values live in public.app_settings (admin-editable from the Admin Panel,
// readable by everyone so the gates work for signed-out visitors too).
// Everything fails OPEN: if settings cannot be loaded, the app behaves
// exactly as it did before Phase 4 (all features on, no maintenance).

export interface FeatureFlags {
  ai_tutor: boolean;
  code_lab: boolean;
  downloads: boolean;
  groups: boolean;
  flashcards: boolean;
  viva: boolean;
  presentations: boolean;
}

export interface MaintenanceSettings {
  enabled: boolean;
  message: string;
}

export interface AppSettings {
  features: FeatureFlags;
  maintenance: MaintenanceSettings;
}

export const FEATURE_LABELS: { key: keyof FeatureFlags; label: string; hint: string }[] = [
  { key: "ai_tutor", label: "AI Tutor", hint: "Chat with the AI professor" },
  { key: "code_lab", label: "Code Lab", hint: "Run code and AI analysis" },
  { key: "downloads", label: "Downloads", hint: "Download buttons on notes" },
  { key: "groups", label: "Study Groups", hint: "Group pages and chat" },
  { key: "flashcards", label: "Flashcards", hint: "Flashcard decks and review" },
  { key: "viva", label: "Viva Prep", hint: "Mock viva sessions" },
  { key: "presentations", label: "Presentations", hint: "AI slide maker" },
];

export const DEFAULT_FEATURES: FeatureFlags = {
  ai_tutor: true,
  code_lab: true,
  downloads: true,
  groups: true,
  flashcards: true,
  viva: true,
  presentations: true,
};

export const DEFAULT_MAINTENANCE: MaintenanceSettings = {
  enabled: false,
  message: "UniGenius is getting a quick upgrade. We will be back shortly.",
};

export const DEFAULT_SETTINGS: AppSettings = {
  features: { ...DEFAULT_FEATURES },
  maintenance: { ...DEFAULT_MAINTENANCE },
};

function asBool(v: unknown, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback;
}

/** Merge a raw app_settings row value over the defaults (unknown keys ignored). */
export function parseFeatureFlags(raw: unknown): FeatureFlags {
  const out = { ...DEFAULT_FEATURES };
  if (raw && typeof raw === "object") {
    const r = raw as Record<string, unknown>;
    (Object.keys(out) as (keyof FeatureFlags)[]).forEach((k) => {
      out[k] = asBool(r[k], out[k]);
    });
  }
  return out;
}

export function parseMaintenance(raw: unknown): MaintenanceSettings {
  const out = { ...DEFAULT_MAINTENANCE };
  if (raw && typeof raw === "object") {
    const r = raw as Record<string, unknown>;
    out.enabled = asBool(r.enabled, out.enabled);
    if (typeof r.message === "string" && r.message.trim()) out.message = r.message;
  }
  return out;
}

/** Build the full settings object from app_settings rows ({key, value}[]). */
export function parseAppSettings(rows: { key: string; value: unknown }[] | null | undefined): AppSettings {
  if (!rows || !Array.isArray(rows)) return { features: { ...DEFAULT_FEATURES }, maintenance: { ...DEFAULT_MAINTENANCE } };
  const byKey = new Map(rows.map((r) => [r.key, r.value]));
  return {
    features: parseFeatureFlags(byKey.get("features")),
    maintenance: parseMaintenance(byKey.get("maintenance")),
  };
}

/** Human-readable byte size for the System Health screen. */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || Number.isNaN(bytes)) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 100 ? 0 : 1)} ${units[i]}`;
}

/** RFC-4180 style CSV text from headers + rows (values stringified, quotes escaped). */
export function toCsv(headers: string[], rows: (unknown)[][]): string {
  const cell = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers.map(cell).join(","), ...rows.map((r) => r.map(cell).join(","))].join("\n");
}

/** Trigger a browser download of CSV text. */
export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** "3h ago" / "2d ago" style relative label for last-active displays. */
export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return "Never";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "Never";
  const diff = Date.now() - then;
  if (diff < 60_000) return "Just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  if (diff < 30 * 86_400_000) return `${Math.floor(diff / 86_400_000)}d ago`;
  return new Date(iso).toLocaleDateString("en-PK", { dateStyle: "medium" });
}
