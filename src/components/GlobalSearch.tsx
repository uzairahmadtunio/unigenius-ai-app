import { useState, useRef, useEffect } from "react";
import { Search, X, BookOpen, StickyNote, FileText, MonitorPlay, PlayCircle, GraduationCap, Loader2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { useDepartment } from "@/contexts/DepartmentContext";
import { getSubjects } from "@/data/subjects";
import { supabase } from "@/integrations/supabase/client";

interface ExtraResult {
  key: string;
  title: string;
  meta: string;
  path: string;
}

interface ExtraGroups {
  subjects: ExtraResult[];
  notes: ExtraResult[];
  papers: ExtraResult[];
  lectures: ExtraResult[];
  videos: ExtraResult[];
  courses: ExtraResult[];
}

const EMPTY_GROUPS: ExtraGroups = { subjects: [], notes: [], papers: [], lectures: [], videos: [], courses: [] };

// Same slug rule as src/data/subjects.ts, so pool subjects open the
// same /subject/:id page as built-in curriculum subjects.
const slugify = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

const GlobalSearch = () => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [extras, setExtras] = useState<ExtraGroups>(EMPTY_GROUPS);
  const [searching, setSearching] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const { department } = useDepartment();

  // Gather all subjects across semesters
  const allSubjects = department
    ? Array.from({ length: 8 }, (_, i) => getSubjects(department, i + 1).map(s => ({ ...s, semester: i + 1 }))).flat()
    : [];

  const filtered = query.trim()
    ? allSubjects.filter(s => s.name.toLowerCase().includes(query.toLowerCase()))
    : [];

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen(o => !o);
      }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Debounced cross-content search: subject pool, notes, past papers,
  // lecture playlists, lecture videos and courses — previously search only
  // matched subject names, so real content was undiscoverable from here.
  // Every group query runs on its own via Promise.allSettled and its error
  // is logged: one failing group is treated as "no results for that group"
  // and can never hide or block the other groups. (Before, all queries
  // shared one Promise.all, errors were never read, and a failed query was
  // indistinguishable from an empty result.)
  useEffect(() => {
    // Strip LIKE wildcards the user did not mean to type, plus the
    // characters that break PostgREST or-filter grammar ( , ( ) ) — a
    // term containing them used to make the whole group query fail with
    // a 400 that was silently swallowed.
    const q = query.trim().replace(/[%_,()]/g, " ").replace(/\s+/g, " ").trim();
    if (q.length < 2) {
      setExtras(EMPTY_GROUPS);
      setSearching(false);
      return;
    }
    setSearching(true);
    const timer = setTimeout(async () => {
      const like = `%${q}%`;
      const orLike = (cols: string[]) => cols.map(c => `${c}.ilike.${like}`).join(",");
      try {
        const settled = await Promise.allSettled([
          supabase.from("subjects_pool" as any).select("id, name, suggested_semester").ilike("name", like).limit(5),
          supabase.from("notes" as any).select("id, title, subject").or(orLike(["title", "subject", "file_name"])).limit(5),
          supabase.from("past_papers" as any).select("id, title, subject, paper_type, year").or(orLike(["title", "subject", "description"])).limit(5),
          supabase.from("subject_lectures" as any).select("id, title, subject, channel").or(orLike(["title", "subject", "channel"])).limit(5),
          supabase.from("lecture_videos" as any).select("id, title").ilike("title", like).limit(5),
          supabase.from("courses" as any).select("id, title, category").or(orLike(["title", "description", "category"])).limit(5),
          supabase.from("course_videos" as any).select("id, title, course:courses(id, title, category)").ilike("title", like).limit(10),
        ]);
        const pick = (idx: number, label: string): any[] => {
          const r = settled[idx];
          if (r.status === "rejected") {
            console.error(`[GlobalSearch] ${label} search failed:`, r.reason);
            return [];
          }
          if (r.value.error) {
            console.error(`[GlobalSearch] ${label} search failed:`, r.value.error);
            return [];
          }
          return (r.value.data as any[]) || [];
        };
        const poolSubjects = pick(0, "Subjects");
        const notes = pick(1, "Notes");
        const papers = pick(2, "Past Papers");
        const lectures = pick(3, "Lecture Playlists");
        const videos = pick(4, "Lecture Videos");
        const courseRows = pick(5, "Courses");
        const courseVideoRows = pick(6, "Course videos");

        // Courses: direct title/description/category matches, plus any
        // course that owns a matching lesson video (course_videos) —
        // merged and de-duplicated by course id. Searching only
        // courses.title missed real course content (e.g. "binary" lives
        // in lesson titles inside the DSA and OS courses, not in any
        // course title or description).
        const courseMap = new Map<string, ExtraResult>();
        for (const c of courseRows) {
          courseMap.set(c.id, {
            key: `course-${c.id}`, title: c.title, meta: c.category || "Course", path: "/courses",
          });
        }
        for (const v of courseVideoRows) {
          const c = (v as any).course;
          if (!c?.id || courseMap.has(c.id)) continue;
          courseMap.set(c.id, {
            key: `course-${c.id}`,
            title: c.title,
            meta: [c.category || "Course", `Lesson: ${v.title}`].join(" · "),
            path: "/courses",
          });
        }

        setExtras({
          subjects: poolSubjects.map(p => ({
            key: `pool-${p.id}`,
            title: p.name,
            meta: p.suggested_semester ? `Subject · Semester ${p.suggested_semester}` : "Subject",
            path: `/subject/${slugify(p.name)}?name=${encodeURIComponent(p.name)}${p.suggested_semester ? `&sem=${p.suggested_semester}` : ""}`,
          })),
          notes: notes.map(n => ({
            key: `note-${n.id}`, title: n.title, meta: n.subject || "Note", path: "/notes",
          })),
          papers: papers.map(p => ({
            key: `paper-${p.id}`, title: p.title, meta: [p.subject, p.paper_type, p.year].filter(Boolean).join(" · ") || "Past paper", path: "/past-papers",
          })),
          lectures: lectures.map(l => ({
            key: `lec-${l.id}`, title: l.title, meta: [l.subject, l.channel].filter(Boolean).join(" · ") || "Playlist", path: "/lectures",
          })),
          videos: videos.map(v => ({
            key: `vid-${v.id}`, title: v.title, meta: "Lecture video", path: "/lectures",
          })),
          courses: Array.from(courseMap.values()).slice(0, 5),
        });
      } catch (err) {
        console.error("[GlobalSearch] search failed:", err);
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);

  const go = (path: string) => {
    navigate(path);
    setOpen(false);
    setQuery("");
  };

  const extraCount = extras.subjects.length + extras.notes.length + extras.papers.length + extras.lectures.length + extras.videos.length + extras.courses.length;
  const hasResults = filtered.length > 0 || extraCount > 0;
  // Pool subjects that are not already shown as built-in curriculum matches.
  const localSubjectNames = new Set(filtered.map(s => s.name.toLowerCase()));
  const poolOnlySubjects = extras.subjects.filter(p => !localSubjectNames.has(p.title.toLowerCase()));

  const renderGroup = (label: string, icon: React.ReactNode, items: ExtraResult[]) =>
    items.length === 0 ? null : (
      <div key={label}>
        <p className="px-3 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
          {icon} {label}
        </p>
        {items.map(item => (
          <button
            key={item.key}
            onClick={() => go(item.path)}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-muted/50 transition-colors text-left"
          >
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground truncate">{item.title}</p>
              <p className="text-xs text-muted-foreground truncate">{item.meta}</p>
            </div>
          </button>
        ))}
      </div>
    );

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="glass rounded-2xl px-3 py-2 flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-all duration-200 hover:-translate-y-px hover:shadow-elevated active:scale-[0.99] w-full max-w-md"
      >
        <Search className="w-4 h-4" />
        <span className="flex-1 text-left">Search subjects, notes, lectures...</span>
        <kbd className="hidden sm:inline text-xs bg-muted px-1.5 py-0.5 rounded">⌘K</kbd>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh] px-4"
            onClick={() => setOpen(false)}
          >
            <div className="fixed inset-0 bg-background/80 backdrop-blur-sm" />
            <motion.div
              initial={{ opacity: 0, y: -20, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -20, scale: 0.95 }}
              onClick={e => e.stopPropagation()}
              className="glass rounded-2xl w-full max-w-lg overflow-hidden relative z-10"
            >
              <div className="flex items-center gap-3 px-4 py-3 border-b border-border/50">
                <Search className="w-4 h-4 text-muted-foreground" />
                <input
                  ref={inputRef}
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder="Search subjects, notes, papers, lectures, courses..."
                  className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none"
                />
                {searching && <Loader2 className="w-4 h-4 text-muted-foreground animate-spin" />}
                <button onClick={() => setOpen(false)}>
                  <X className="w-4 h-4 text-muted-foreground" />
                </button>
              </div>

              {hasResults && (
                <div className="max-h-[50vh] overflow-y-auto p-2">
                  {(filtered.length > 0 || poolOnlySubjects.length > 0) && (
                    <div>
                      <p className="px-3 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
                        <BookOpen className="w-3.5 h-3.5" /> Subjects
                      </p>
                      {filtered.map(sub => (
                        <button
                          key={`${sub.id}-${sub.semester}`}
                          onClick={() => go(`/subject/${sub.id}?name=${encodeURIComponent(sub.name)}&sem=${sub.semester}`)}
                          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-muted/50 transition-colors text-left"
                        >
                          <span className="text-lg">{sub.icon}</span>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-foreground truncate">{sub.name}</p>
                            <p className="text-xs text-muted-foreground">Semester {sub.semester}</p>
                          </div>
                        </button>
                      ))}
                      {poolOnlySubjects.map(item => (
                        <button
                          key={item.key}
                          onClick={() => go(item.path)}
                          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-muted/50 transition-colors text-left"
                        >
                          <span className="text-lg">📚</span>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-foreground truncate">{item.title}</p>
                            <p className="text-xs text-muted-foreground truncate">{item.meta}</p>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                  {renderGroup("Notes", <StickyNote className="w-3.5 h-3.5" />, extras.notes)}
                  {renderGroup("Past Papers", <FileText className="w-3.5 h-3.5" />, extras.papers)}
                  {renderGroup("Lecture Playlists", <MonitorPlay className="w-3.5 h-3.5" />, extras.lectures)}
                  {renderGroup("Lecture Videos", <PlayCircle className="w-3.5 h-3.5" />, extras.videos)}
                  {renderGroup("Courses", <GraduationCap className="w-3.5 h-3.5" />, extras.courses)}
                </div>
              )}

              {query.trim() && !hasResults && !searching && (
                <div className="p-6 text-center text-sm text-muted-foreground">No results found</div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
};

export default GlobalSearch;
