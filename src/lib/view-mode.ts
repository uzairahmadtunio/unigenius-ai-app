/**
 * View-mode logic for the role switch system (Panels Program, Part A).
 *
 * A user's account keeps its real roles forever; the *view mode* only
 * changes which face of the app they are looking at. Admins may view as
 * admin/teacher/student, teachers as teacher/student, students only as
 * students. Switching never grants a role — grants stay in the Admin
 * Panel — so the available modes are a pure function of the real roles.
 */

export type ViewMode = "admin" | "teacher" | "student";

export const VIEW_MODE_STORAGE_KEY = "ug-view-mode";

export const VIEW_MODE_LABELS: Record<ViewMode, string> = {
  admin: "Admin",
  teacher: "Teacher",
  student: "Student",
};

/** Modes this account may switch into, most-privileged first. */
export function availableModes(roles: readonly string[]): ViewMode[] {
  if (roles.includes("admin")) return ["admin", "teacher", "student"];
  if (roles.includes("teacher")) return ["teacher", "student"];
  return ["student"];
}

/** The mode the app should open in: the stored choice when it is still
 *  allowed, otherwise the account's primary (most-privileged) mode. */
export function resolveViewMode(roles: readonly string[], stored: string | null): ViewMode {
  const modes = availableModes(roles);
  if (stored && (modes as string[]).includes(stored)) return stored as ViewMode;
  return modes[0];
}

/** True when the account's real top role differs from the active mode —
 *  i.e. the user is "viewing as" someone else and a badge should show. */
export function isViewingAs(roles: readonly string[], mode: ViewMode): boolean {
  return availableModes(roles)[0] !== mode;
}
