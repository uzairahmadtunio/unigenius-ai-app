import { useEffect, useMemo, useState } from "react";
import { Loader2, Paperclip } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { createPost, uploadClassFile, type ClassPostRow, type ClassPostType } from "@/lib/classes";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  classId: string;
  teacherId: string;
  defaultType: Exclude<ClassPostType, "announcement">;
  defaultSubject?: string | null;
  onCreated: (post: ClassPostRow) => void;
}

const TITLES: Record<Props["defaultType"], string> = {
  material: "Upload Material",
  homework: "New Homework",
  test: "New Class Test",
};

/**
 * Create classwork for one class. Tests reuse the existing Question
 * Bank: the teacher picks a bank subject (+ optional topic) and the
 * number of questions; answers stay server-side and the attempt is
 * scored by the submit_class_test RPC.
 */
export const CreatePostDialog = ({ open, onOpenChange, classId, teacherId, defaultType, defaultSubject, onCreated }: Props) => {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [maxMarks, setMaxMarks] = useState("");
  const [link, setLink] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  // Test fields
  const [subjects, setSubjects] = useState<string[]>([]);
  const [subject, setSubject] = useState("");
  const [subjectQuery, setSubjectQuery] = useState("");
  const [topic, setTopic] = useState("");
  const [topics, setTopics] = useState<string[]>([]);
  const [qCount, setQCount] = useState("10");
  const [marksPer, setMarksPer] = useState("1");

  useEffect(() => {
    if (!open || defaultType !== "test") return;
    let live = true;
    (async () => {
      try {
        const rows: { subject?: string; topic?: string }[] = [];
        const PAGE = 1000;
        for (let from = 0; ; from += PAGE) {
          const { data: chunk, error } = await (supabase.rpc("list_question_bank_safe" as any) as any).range(from, from + PAGE - 1);
          if (error || !chunk?.length) break;
          rows.push(...chunk);
          if (chunk.length < PAGE) break;
        }
        if (!live) return;
        const subs = [...new Set(rows.map((r) => String(r.subject || "")).filter(Boolean))].sort();
        setSubjects(subs);
        const wanted = defaultSubject && subs.includes(defaultSubject) ? defaultSubject : subs[0] || "";
        setSubject(wanted);
        setTopics([...new Set(rows.filter((r) => r.subject === wanted).map((r) => String(r.topic || "")).filter(Boolean))].sort());
      } catch { /* subject list is best-effort; teacher can still type below */ }
    })();
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, defaultType]);

  useEffect(() => {
    if (defaultType !== "test" || !subject) return;
    let live = true;
    (async () => {
      try {
        const { data } = await (supabase.rpc("list_question_bank_safe" as any) as any).range(0, 9999);
        if (!live || !data) return;
        setTopics([...new Set((data as any[]).filter((r) => r.subject === subject).map((r) => String(r.topic || "")).filter(Boolean))].sort());
        setTopic("");
      } catch { /* ignore */ }
    })();
    return () => { live = false; };
  }, [subject, defaultType]);

  const totalMarks = useMemo(() => {
    if (defaultType === "test") return (Number(qCount) || 0) * (Number(marksPer) || 0);
    return Number(maxMarks) || null;
  }, [defaultType, qCount, marksPer, maxMarks]);

  const submit = async () => {
    if (defaultType !== "test" && !title.trim()) {
      toast.error("Add a title first");
      return;
    }
    if (defaultType === "test" && !subject) {
      toast.error("Pick a subject from the Question Bank");
      return;
    }
    setSaving(true);
    try {
      let attachmentUrl: string | undefined;
      let attachmentName: string | undefined;
      if (file) {
        const up = await uploadClassFile(classId, "materials", teacherId, file);
        attachmentUrl = up.path;
        attachmentName = up.name;
      } else if (link.trim()) {
        attachmentUrl = link.trim();
        attachmentName = title.trim() || "Link";
      }
      const post = await createPost(classId, teacherId, {
        type: defaultType,
        title: defaultType === "test" ? (title.trim() || `${subject} Test`) : title,
        body,
        attachmentUrl,
        attachmentName,
        dueAt: dueAt ? new Date(dueAt).toISOString() : null,
        maxMarks: totalMarks,
        meta: defaultType === "test"
          ? { subject, topic: topic || "", question_count: Math.min(50, Math.max(1, Number(qCount) || 10)), marks_per_question: Math.max(1, Number(marksPer) || 1) }
          : {},
      });
      toast.success(defaultType === "test" ? "Test posted to the class" : "Posted to the class");
      onCreated(post);
      onOpenChange(false);
      setTitle(""); setBody(""); setDueAt(""); setMaxMarks(""); setLink(""); setFile(null); setTopic("");
    } catch (e: any) {
      toast.error(e?.message || "Could not create it");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-2xl max-w-md max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display">{TITLES[defaultType]}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3.5">
          <div className="space-y-1.5">
            <Label htmlFor="cp-title">Title {defaultType === "test" && "(optional)"}</Label>
            <Input id="cp-title" placeholder={defaultType === "homework" ? "e.g. Assignment 2 — Truth Tables" : defaultType === "material" ? "e.g. Lab Manual 04 — K-Maps" : "e.g. Chapter 3 Quiz"} value={title} onChange={(e) => setTitle(e.target.value)} className="rounded-xl" />
          </div>

          {defaultType === "test" ? (
            <>
              <div className="space-y-1.5">
                <Label>Subject (from Question Bank)</Label>
                <Select value={subject} onValueChange={setSubject}>
                  <SelectTrigger className="rounded-xl"><SelectValue placeholder="Pick a subject" /></SelectTrigger>
                  <SelectContent>
                    {/* 54 bank subjects are too many to scroll blind —
                        filter box on top (audit 2026-11-27, item #12). */}
                    <div className="px-2 pb-2 pt-1 sticky top-0 bg-popover z-10">
                      <Input
                        placeholder="Search subjects…"
                        value={subjectQuery}
                        onChange={(e) => setSubjectQuery(e.target.value)}
                        onKeyDown={(e) => e.stopPropagation()}
                        className="h-8 rounded-lg text-xs"
                      />
                    </div>
                    {subjects
                      .filter((s) => s.toLowerCase().includes(subjectQuery.trim().toLowerCase()))
                      .map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                    {subjects.length > 0 && subjects.every((s) => !s.toLowerCase().includes(subjectQuery.trim().toLowerCase())) && (
                      <p className="px-2 py-2 text-xs text-muted-foreground">No subjects match your search.</p>
                    )}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Topic (optional)</Label>
                <Select value={topic || "__all"} onValueChange={(v) => setTopic(v === "__all" ? "" : v)}>
                  <SelectTrigger className="rounded-xl"><SelectValue placeholder="Whole subject" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all">Whole subject</SelectItem>
                    {topics.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-2.5">
                <div className="space-y-1.5">
                  <Label htmlFor="cp-qcount">Questions</Label>
                  <Input id="cp-qcount" type="number" min={1} max={50} value={qCount} onChange={(e) => setQCount(e.target.value)} className="rounded-xl" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="cp-marksper">Marks per question</Label>
                  <Input id="cp-marksper" type="number" min={1} max={20} value={marksPer} onChange={(e) => setMarksPer(e.target.value)} className="rounded-xl" />
                </div>
              </div>
              <p className="text-[11px] text-muted-foreground">Total marks: <b className="text-foreground">{totalMarks || 0}</b> · Questions are picked from the bank when a student starts; answers are never shown to students.</p>
            </>
          ) : (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="cp-body">{defaultType === "homework" ? "Instructions" : "Description (optional)"}</Label>
                <Textarea id="cp-body" rows={3} placeholder={defaultType === "homework" ? "What should students do?" : "Anything students should know"} value={body} onChange={(e) => setBody(e.target.value)} className="rounded-xl" />
              </div>
              {defaultType === "material" && (
                <>
                  <div className="space-y-1.5">
                    <Label htmlFor="cp-file">Attach a file (PDF, notes, lab manual, video…)</Label>
                    <label htmlFor="cp-file" className="flex items-center gap-2 rounded-xl border border-dashed border-primary/40 px-3 py-2.5 text-sm text-muted-foreground cursor-pointer hover:bg-primary/5">
                      <Paperclip className="w-4 h-4 text-primary" />
                      {file ? file.name : "Choose a file"}
                    </label>
                    <input id="cp-file" type="file" className="hidden" onChange={(e) => setFile(e.target.files?.[0] || null)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="cp-link">…or paste a link (lecture video, Drive file)</Label>
                    <Input id="cp-link" placeholder="https://…" value={link} onChange={(e) => setLink(e.target.value)} className="rounded-xl" />
                  </div>
                </>
              )}
              {defaultType === "homework" && (
                <div className="space-y-1.5">
                  <Label htmlFor="cp-marks">Max marks</Label>
                  <Input id="cp-marks" type="number" min={1} max={1000} placeholder="10" value={maxMarks} onChange={(e) => setMaxMarks(e.target.value)} className="rounded-xl" />
                </div>
              )}
            </>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="cp-due">Due date (optional)</Label>
            <Input id="cp-due" type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)} className="rounded-xl" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" className="rounded-xl" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button className="rounded-xl gradient-primary" onClick={submit} disabled={saving}>
            {saving && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />} Post to Class
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default CreatePostDialog;
