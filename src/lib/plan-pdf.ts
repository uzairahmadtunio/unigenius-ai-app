import { jsPDF } from "jspdf";

/**
 * Study-plan PDF export (Uzair, 2026-11-27): the student can download
 * the plan they made and keep it with them. Built with jsPDF from the
 * plan's own data — header with the plan's name, meta line, the weekly
 * schedule (markdown lightly cleaned to plain text) and daily tasks.
 */
export interface PlanPdfTask {
  task_date: string;
  subject?: string | null;
  title: string;
  done: boolean;
}

export interface PlanPdfData {
  title?: string | null;
  semester?: number | null;
  subjects?: string[] | null;
  weeklyHours?: number | null;
  examDate?: string | null;
  schedule: string;
  tasks?: PlanPdfTask[];
}

const cleanLine = (raw: string): string => {
  let s = raw.replace(/\*\*/g, "").replace(/`/g, "").replace(/\*/g, "");
  s = s.replace(/^#{1,6}\s*/, "").replace(/^>\s*/, "");
  // Markdown table separator rows (|---|---|) carry no content.
  if (/^\s*\|?[\s:|-]+\|?\s*$/.test(s) && s.includes("-")) return "";
  s = s.replace(/\|/g, "  ").replace(/\s{3,}/g, "  ").trimEnd();
  s = s.replace(/^-\s+/, "• ");
  return s;
};

export function planPdfFilename(title?: string | null): string {
  const base = (title || "UniGenius Study Plan")
    .replace(/[^\w\- ]+/g, "")
    .trim()
    .replace(/\s+/g, "-");
  return `${base || "UniGenius-Study-Plan"}.pdf`;
}

export function downloadPlanPdf(data: PlanPdfData): void {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 16;
  const width = pageW - margin * 2;
  let y = 18;

  const ensure = (h: number) => {
    if (y + h > pageH - 14) {
      doc.addPage();
      y = 18;
    }
  };

  const text = (
    s: string,
    size: number,
    style: "normal" | "bold" = "normal",
    color: [number, number, number] = [30, 27, 46],
    gap = 2,
  ) => {
    doc.setFont("helvetica", style);
    doc.setFontSize(size);
    doc.setTextColor(color[0], color[1], color[2]);
    const lines = doc.splitTextToSize(s, width) as string[];
    for (const line of lines) {
      ensure(size * 0.55 + 2);
      doc.text(line, margin, y);
      y += size * 0.52 + 1.6;
    }
    y += gap;
  };

  // Header
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(124, 92, 255);
  doc.text("UNIGENIUS AI — STUDY PLANNER", margin, y);
  y += 8;
  text(data.title?.trim() || "My Study Plan", 19, "bold", [23, 20, 43], 3);

  const meta: string[] = [];
  if (data.semester) meta.push(`Semester ${data.semester}`);
  if (data.weeklyHours) meta.push(`${data.weeklyHours} hours/week`);
  if (data.examDate) meta.push(`Exam date: ${data.examDate}`);
  if (meta.length) text(meta.join("   •   "), 10.5, "normal", [90, 86, 120], 1);
  if (data.subjects?.length) {
    text(`Subjects: ${data.subjects.join(", ")}`, 10.5, "normal", [90, 86, 120], 4);
  }

  doc.setDrawColor(124, 92, 255);
  doc.setLineWidth(0.5);
  doc.line(margin, y, pageW - margin, y);
  y += 7;

  text("Weekly Plan", 13.5, "bold", [23, 20, 43], 2);
  for (const rawLine of (data.schedule || "").split("\n")) {
    const line = cleanLine(rawLine);
    if (!line.trim()) {
      y += 2.2;
      continue;
    }
    const isHeading = /^#{1,6}\s/.test(rawLine);
    text(line, isHeading ? 12 : 10.5, isHeading ? "bold" : "normal", [30, 27, 46], 0.8);
  }

  if (data.tasks?.length) {
    y += 4;
    text("Daily Tasks", 13.5, "bold", [23, 20, 43], 2);
    const byDate = new Map<string, PlanPdfTask[]>();
    for (const t of data.tasks) {
      const arr = byDate.get(t.task_date) || [];
      arr.push(t);
      byDate.set(t.task_date, arr);
    }
    for (const [date, tasks] of [...byDate.entries()].sort()) {
      text(date, 11, "bold", [90, 86, 120], 1);
      for (const t of tasks) {
        text(`${t.done ? "[x]" : "[ ]"} ${t.subject ? `${t.subject}: ` : ""}${t.title}`, 10.5, "normal", [30, 27, 46], 0.6);
      }
      y += 1.5;
    }
  }

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(140, 136, 165);
  doc.text("Made with UniGenius AI — unigenius.vercel.app", margin, pageH - 8);

  doc.save(planPdfFilename(data.title));
}
