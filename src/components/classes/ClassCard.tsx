import { useNavigate } from "react-router-dom";
import { Users } from "lucide-react";
import { classCoverStyle, classGlyph, pct, type ClassRow } from "@/lib/classes";
import { cn } from "@/lib/utils";

interface Props {
  cls: ClassRow;
  studentCount?: number;
  /** 0–100 class average (teacher) or my average (student) shown as a ring. */
  avgPct?: number | null;
  avgLabel?: string;
  footerNote?: string;
  onClick?: () => void;
}

/** Class card with the patterned violet cover band from the approved
 *  design preview — used on the teacher dashboard, the classes page
 *  and the student home. */
export const ClassCard = ({ cls, studentCount, avgPct, avgLabel, footerNote, onClick }: Props) => {
  const navigate = useNavigate();
  const go = onClick || (() => navigate(`/classes/${cls.id}`));
  const sub = [cls.program, cls.semester ? `Semester ${cls.semester}` : null, cls.section ? `Section ${cls.section}` : null]
    .filter(Boolean)
    .join(" · ");

  return (
    <button
      onClick={go}
      className="w-full text-left rounded-2xl border border-primary/20 bg-card overflow-hidden shadow-sm hover:shadow-md hover:border-primary/40 transition-all active:scale-[0.99]"
    >
      <div className="relative h-16 px-4 py-2.5 overflow-hidden" style={{ background: classCoverStyle(cls.cover) }}>
        <div aria-hidden className="absolute -right-4 -top-8 w-28 h-28 rounded-full bg-white/15" />
        <div aria-hidden className="absolute right-10 -bottom-10 w-20 h-20 rounded-full bg-white/10" />
        <div className="relative flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-white font-display font-bold text-[15px] leading-tight truncate">{cls.title}</p>
            {sub && <p className="text-white/85 text-[11px] mt-0.5 truncate">{sub}</p>}
          </div>
          <span className="shrink-0 rounded-md bg-black/35 px-1.5 py-0.5 text-[10px] font-bold tracking-widest text-white">
            {cls.code}
          </span>
        </div>
        <span aria-hidden className="absolute right-3 bottom-1 text-[26px] leading-none opacity-40 select-none">
          {classGlyph(cls)}
        </span>
      </div>
      <div className="flex items-center justify-between gap-2 px-4 py-2.5 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5 min-w-0">
          <Users className="w-3.5 h-3.5 shrink-0" />
          {studentCount !== undefined ? (
            <span><b className="text-foreground">{studentCount}</b> students</span>
          ) : (
            <span className="truncate">{cls.subject || footerNote || "Class"}</span>
          )}
        </span>
        {footerNote && studentCount !== undefined && <span className="truncate">{footerNote}</span>}
        {avgPct !== null && avgPct !== undefined && (
          <span className="flex items-center gap-1.5 shrink-0">
            <span className="text-[11px]">{avgLabel || "avg"}</span>
            <span
              className="w-9 h-9 rounded-full p-[2.5px]"
              style={{ background: `conic-gradient(#8A6CFF ${pct(avgPct, 100)}%, hsl(var(--muted)) 0)` }}
            >
              <span className="w-full h-full rounded-full bg-card flex items-center justify-center text-[10px] font-bold text-foreground">
                {Math.round(avgPct)}%
              </span>
            </span>
          </span>
        )}
        {cls.archived && <span className="shrink-0 text-[10px] font-bold text-amber-500">ARCHIVED</span>}
      </div>
    </button>
  );
};

export default ClassCard;
