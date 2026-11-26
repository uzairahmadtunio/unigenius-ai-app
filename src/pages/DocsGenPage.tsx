import { useState, useEffect } from "react";
import { FileText, Download, Loader2, Bot, FileDown, File, Paperclip, X, Image as ImageIcon, FlaskConical, NotebookPen, Save, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useDepartment, departmentInfo } from "@/contexts/DepartmentContext";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { getSubjects } from "@/data/subjects";
import PageShell from "@/components/PageShell";
import MarkdownMessage from "@/components/MarkdownMessage";
import { toast } from "sonner";
import { authHeader } from "@/lib/auth-header";
import { notifyAiTier } from "@/lib/ai-tier-notifier";
import { useAdmin } from "@/hooks/use-admin";
import { generateProfessionalPDF, generateDOCX } from "@/lib/pdf-generator";
import ThinkingAnimation from "@/components/ThinkingAnimation";

import { usePro } from "@/hooks/use-pro";
import ProPaywall from "@/components/ProPaywall";

const DocsGenPage = () => {
  const { isAdmin } = useAdmin();
  const { isPro, loading: proLoading } = usePro();
  const { department } = useDepartment();
  const { user } = useAuth();
  const [semester, setSemester] = useState(1);
  const [docType, setDocType] = useState<"lab" | "assignment">("lab");
  const [subject, setSubject] = useState("");
  const [topic, setTopic] = useState("");
  const [teacherName, setTeacherName] = useState("");
  const [additionalNotes, setAdditionalNotes] = useState("");
  const [content, setContent] = useState("");
  const [outputFormat, setOutputFormat] = useState<"docx" | "pdf">("docx");
  const [isGenerating, setIsGenerating] = useState(false);
  const [attachments, setAttachments] = useState<Array<{ name: string; mimeType: string; data: string; size: number }>>([]);

  const [studentName, setStudentName] = useState("");
  const [rollNumber, setRollNumber] = useState("");
  const [studentDept, setStudentDept] = useState("");
  const [studentSection, setStudentSection] = useState("");
  const [studentUniversity, setStudentUniversity] = useState("The University of Larkano");

  // Saved teacher-format templates (per kind): a teacher's required
  // format saved once, re-applied to every new document.
  interface TeacherTemplate { id: string; name: string; teacher_name: string | null; instructions: string }
  const [templates, setTemplates] = useState<TeacherTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");
  const [newTemplateName, setNewTemplateName] = useState("");
  const [savingTemplate, setSavingTemplate] = useState(false);

  const loadTemplates = async () => {
    if (!user) return;
    const { data } = await supabase
      .from("teacher_templates" as any)
      .select("id, name, teacher_name, instructions")
      .eq("user_id", user.id)
      .eq("kind", docType)
      .order("created_at", { ascending: false });
    setTemplates((data as unknown as TeacherTemplate[]) || []);
    setSelectedTemplateId("");
  };

  useEffect(() => {
    loadTemplates();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, docType]);

  const applyTemplate = (id: string) => {
    setSelectedTemplateId(id);
    const t = templates.find((x) => x.id === id);
    if (!t) return;
    setAdditionalNotes(t.instructions || "");
    if (t.teacher_name) setTeacherName(t.teacher_name);
    toast.success(`Teacher format "${t.name}" applied`);
  };

  const saveTemplate = async () => {
    if (!user) return;
    if (!newTemplateName.trim()) { toast.error("Write a name for the template"); return; }
    if (!additionalNotes.trim() && !teacherName.trim()) {
      toast.error("First write the instructions or the teacher's name — that format will be saved");
      return;
    }
    setSavingTemplate(true);
    const { error } = await supabase.from("teacher_templates" as any).insert({
      user_id: user.id,
      kind: docType,
      name: newTemplateName.trim(),
      teacher_name: teacherName.trim() || null,
      instructions: additionalNotes,
    } as any);
    setSavingTemplate(false);
    if (error) { toast.error("The template could not be saved"); return; }
    setNewTemplateName("");
    toast.success("Teacher format saved — next time it will apply in one tap");
    loadTemplates();
  };

  const deleteTemplate = async () => {
    if (!selectedTemplateId) return;
    const { error } = await supabase
      .from("teacher_templates" as any)
      .delete()
      .eq("id", selectedTemplateId);
    if (error) { toast.error("Could not delete"); return; }
    toast.success("Template deleted");
    loadTemplates();
  };

  const subjects = department ? getSubjects(department, semester) : [];

  useEffect(() => {
    if (!user) return;
    const fetchProfile = async () => {
      const { data } = await supabase
        .from("profiles")
        .select("display_name, roll_number, current_semester, section, university")
        .eq("user_id", user.id)
        .single();
      if (data) {
        const p = data as any;
        setStudentName(p.display_name || "");
        setRollNumber(p.roll_number || "");
        setStudentSection(p.section || "");
        setStudentUniversity(p.university || "The University of Larkano");
        if (p.current_semester) setSemester(p.current_semester);
      }
    };
    fetchProfile();
    if (department) {
      setStudentDept(departmentInfo[department]?.fullName || "");
    }
  }, [user, department]);

  const handleFilePick = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const MAX_TOTAL = 8 * 1024 * 1024; // ~8 MB combined
    const allowed = ["image/png", "image/jpeg", "image/webp", "image/jpg", "application/pdf"];
    const next = [...attachments];
    let total = next.reduce((s, a) => s + a.size, 0);

    for (const f of Array.from(files)) {
      if (next.length >= 6) { toast.error("Max 6 files"); break; }
      if (!allowed.includes(f.type)) { toast.error(`${f.name}: only images or PDF`); continue; }
      if (total + f.size > MAX_TOTAL) { toast.error("Total attachment size exceeds 8 MB"); break; }
      const data = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => {
          const result = String(r.result || "");
          const idx = result.indexOf(",");
          resolve(idx >= 0 ? result.slice(idx + 1) : result);
        };
        r.onerror = () => reject(r.error);
        r.readAsDataURL(f);
      });
      next.push({ name: f.name, mimeType: f.type, data, size: f.size });
      total += f.size;
    }
    setAttachments(next);
  };

  const removeAttachment = (i: number) => setAttachments(attachments.filter((_, idx) => idx !== i));

  const generateDoc = async () => {
    if (!subject || !topic.trim()) { toast.error("Select a subject and enter a topic"); return; }
    setIsGenerating(true);
    setContent("");

    try {
      const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-doc`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `${await authHeader()}`,
        },
        body: JSON.stringify({
          type: docType,
          subject,
          topic,
          additionalNotes,
          semester,
          media: attachments.map(a => ({ mimeType: a.mimeType, data: a.data })),
          studentInfo: {
            name: studentName || "",
            rollNumber: rollNumber || "",
            department: studentDept || "",
            section: studentSection || "",
            university: studentUniversity || "The University of Larkano",
          },
        }),
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.error || "Generation failed");
      }
      notifyAiTier(resp, isAdmin);
      if (!resp.body) throw new Error("No response body");

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let result = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let idx: number;
        while ((idx = buffer.indexOf("\n")) !== -1) {
          let line = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 1);
          if (line.endsWith("\r")) line = line.slice(0, -1);
          if (!line.startsWith("data: ")) continue;
          const json = line.slice(6).trim();
          if (json === "[DONE]") break;
          try {
            const parsed = JSON.parse(json);
            const c = parsed.choices?.[0]?.delta?.content;
            if (c) { result += c; setContent(result); }
          } catch { buffer = line + "\n" + buffer; break; }
        }
      }
    } catch (err: any) {
      toast.error(err.message || "Generation failed");
    } finally {
      setIsGenerating(false);
    }
  };

  const pdfOpts = {
    subject, topic, teacherName, semester, docType: docType as "assignment" | "lab",
    studentInfo: { name: studentName, rollNumber, department: studentDept, section: studentSection, university: studentUniversity },
  };

  const handlePDF = () => {
    if (!content) { toast.error("Generate a document first"); return; }
    generateProfessionalPDF(content, pdfOpts);
    toast.success("Professional PDF downloaded!");
  };

  const handleDOCX = async () => {
    if (!content) { toast.error("Generate a document first"); return; }
    await generateDOCX(content, pdfOpts);
    toast.success("Professional Word document downloaded!");
  };

  return (
    <PageShell
      title="Docs Generator"
      subtitle="Lab Manuals & Assignments"
      icon={<div className="w-10 h-10 rounded-xl bg-primary/15 flex items-center justify-center"><FileText className="w-5 h-5 text-primary" /></div>}
    >
      <div className="relative min-h-[400px]">
        {!isPro && !proLoading && <ProPaywall feature="professional lab manuals and AI document generation" />}
        <div className="grid lg:grid-cols-3 gap-4 pb-6">
        {/* Form */}
        <div className="space-y-4">
          <div id="docs-gen-form" className="glass rounded-2xl p-6 space-y-4 scroll-mt-24">
            <h3 className="font-display font-semibold text-foreground">Configure Document</h3>

            {/* Two separate studios — Lab Manual and Assignment are
                distinct sections with their own format conventions,
                not one form with a dropdown. */}
            <div className="space-y-2">
              <label className="text-xs text-muted-foreground">Choose Studio</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setDocType("lab")}
                  className={`rounded-xl border-2 p-3 text-left transition-colors ${
                    docType === "lab"
                      ? "border-primary bg-primary/10"
                      : "border-border/60 hover:border-primary/40"
                  }`}
                >
                  <FlaskConical className="w-5 h-5 text-primary mb-1.5" />
                  <p className="text-sm font-semibold text-foreground leading-tight">Lab Manual Studio</p>
                  <p className="text-[11px] text-muted-foreground leading-snug mt-0.5">
                    Experiments, code + output, teacher's lab format
                  </p>
                </button>
                <button
                  type="button"
                  onClick={() => setDocType("assignment")}
                  className={`rounded-xl border-2 p-3 text-left transition-colors ${
                    docType === "assignment"
                      ? "border-primary bg-primary/10"
                      : "border-border/60 hover:border-primary/40"
                  }`}
                >
                  <NotebookPen className="w-5 h-5 text-primary mb-1.5" />
                  <p className="text-sm font-semibold text-foreground leading-tight">Assignment Studio</p>
                  <p className="text-[11px] text-muted-foreground leading-snug mt-0.5">
                    Reports & write-ups, references, teacher's format
                  </p>
                </button>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs text-muted-foreground">Semester</label>
              <Select value={String(semester)} onValueChange={(v) => { setSemester(Number(v)); setSubject(""); }}>
                <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {[1,2,3,4,5,6,7,8].map((s) => (
                    <SelectItem key={s} value={String(s)}>Semester {s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-xs text-muted-foreground">Subject</label>
              <Select value={subject} onValueChange={setSubject}>
                <SelectTrigger className="rounded-xl"><SelectValue placeholder="Select subject" /></SelectTrigger>
                <SelectContent>
                  {subjects.map((s) => (
                    <SelectItem key={s.id} value={s.name}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-xs text-muted-foreground">
                {docType === "lab" ? "Experiment / Topic" : "Assignment Topic"}
              </label>
              <Input
                id="docs-topic-input"
                placeholder={docType === "lab" ? "e.g., Linked List Implementation" : "e.g., OOP Concepts Report"}
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                className="rounded-xl"
              />
            </div>

            <div className="space-y-2">
              <label className="text-xs text-muted-foreground">Teacher Name (optional)</label>
              <Input
                placeholder="e.g., Prof. Ahmed Ali"
                value={teacherName}
                onChange={(e) => setTeacherName(e.target.value)}
                className="rounded-xl"
              />
            </div>

            {/* Student Info */}
            <div className="space-y-2 border-t border-border/50 pt-4">
              <label className="text-xs text-muted-foreground font-medium">Student Information</label>
              <Input placeholder="Your Name" value={studentName} onChange={(e) => setStudentName(e.target.value)} className="rounded-xl" />
              <Input placeholder="Roll Number" value={rollNumber} onChange={(e) => setRollNumber(e.target.value)} className="rounded-xl" />
              <Input placeholder="Department" value={studentDept} onChange={(e) => setStudentDept(e.target.value)} className="rounded-xl" />
            </div>

            <div className="space-y-2">
              <label className="text-xs text-muted-foreground">Additional Instructions (optional)</label>
              <Textarea
                placeholder="Any specific requirements, page count, formatting notes..."
                value={additionalNotes}
                onChange={(e) => setAdditionalNotes(e.target.value)}
                className="rounded-xl min-h-[60px]"
                rows={2}
              />
            </div>

            {/* Teacher Format templates: save this teacher's required
                format once, re-apply it to every document. */}
            <div className="space-y-2 border-t border-border/50 pt-4">
              <label className="text-xs text-muted-foreground font-medium">
                Teacher Format (saved templates)
              </label>
              {templates.length > 0 && (
                <div className="flex gap-2">
                  <Select value={selectedTemplateId} onValueChange={applyTemplate}>
                    <SelectTrigger className="rounded-xl flex-1">
                      <SelectValue placeholder="Apply a saved format" />
                    </SelectTrigger>
                    <SelectContent>
                      {templates.map((t) => (
                        <SelectItem key={t.id} value={t.id}>
                          {t.name}
                          {t.teacher_name ? ` — ${t.teacher_name}` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="rounded-xl shrink-0"
                    disabled={!selectedTemplateId}
                    onClick={deleteTemplate}
                    aria-label="Delete template"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              )}
              <div className="flex gap-2">
                <Input
                  placeholder="e.g., Soban Lab Format"
                  value={newTemplateName}
                  onChange={(e) => setNewTemplateName(e.target.value)}
                  className="rounded-xl flex-1"
                />
                <Button
                  type="button"
                  variant="outline"
                  className="rounded-xl gap-1.5 shrink-0"
                  disabled={savingTemplate}
                  onClick={saveTemplate}
                >
                  {savingTemplate ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                  Save format
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground leading-snug">
                The instructions and teacher name above will be saved under this name — next time, just
                select the template and the format will apply automatically.
              </p>
            </div>

            {/* Teacher brief upload (image / PDF) */}
            <div className="space-y-2 border-t border-border/50 pt-4">
              <label className="text-xs text-muted-foreground font-medium flex items-center gap-1.5">
                <Paperclip className="w-3.5 h-3.5" />
                Teacher's Brief (optional)
              </label>
              <label className="flex flex-col items-center justify-center gap-1.5 px-3 py-4 rounded-xl border-2 border-dashed border-border/60 hover:border-primary/40 hover:bg-primary/5 cursor-pointer transition-colors">
                <ImageIcon className="w-5 h-5 text-muted-foreground" />
                <span className="text-xs text-muted-foreground text-center leading-tight">
                  Upload teacher's assignment / lab manual<br />
                  <span className="text-[10px] opacity-70">Images or PDF · up to 6 files · 8 MB total</span>
                </span>
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,application/pdf"
                  multiple
                  className="hidden"
                  onChange={(e) => { handleFilePick(e.target.files); e.target.value = ""; }}
                />
              </label>
              {attachments.length > 0 && (
                <div className="space-y-1.5">
                  {attachments.map((a, i) => (
                    <div key={i} className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-muted/40 border border-border/40">
                      <File className="w-3.5 h-3.5 text-primary flex-shrink-0" />
                      <span className="text-xs text-foreground truncate flex-1">{a.name}</span>
                      <span className="text-[10px] text-muted-foreground">{(a.size / 1024).toFixed(0)} KB</span>
                      <button
                        onClick={() => removeAttachment(i)}
                        className="text-muted-foreground hover:text-destructive transition-colors"
                        aria-label="Remove"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>


            <Button
              onClick={generateDoc}
              disabled={isGenerating}
              className="w-full rounded-xl gradient-primary text-primary-foreground gap-2"
            >
              {isGenerating ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
              {isGenerating ? "Generating..." : `Generate ${docType === "lab" ? "Lab Manual" : "Assignment"}`}
            </Button>

            {content && (
              <div className="flex gap-2">
                <Button
                  onClick={handlePDF}
                  variant={outputFormat === "pdf" ? "default" : "outline"}
                  className={`flex-1 rounded-xl gap-2 ${outputFormat === "pdf" ? "gradient-button text-primary-foreground" : "text-primary border-primary/30 hover:bg-primary/10"}`}
                >
                  <FileDown className="w-4 h-4" /> PDF
                </Button>
                <Button
                  onClick={handleDOCX}
                  variant={outputFormat === "docx" ? "default" : "outline"}
                  className={`flex-1 rounded-xl gap-2 ${outputFormat === "docx" ? "gradient-button text-primary-foreground" : "text-primary border-primary/30 hover:bg-primary/10"}`}
                >
                  <File className="w-4 h-4" /> DOCX
                </Button>
              </div>
            )}
          </div>

          {/* Mode info — the generation flow already produces both DOCX
              and PDF, so the format choice is a real segmented control:
              it marks which download is primary after generation. */}
          <div className="glass rounded-2xl p-4 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <h4 className="font-display font-semibold text-foreground text-sm flex items-center gap-2">
                {docType === "lab"
                  ? <FlaskConical className="w-4 h-4 text-primary" />
                  : <NotebookPen className="w-4 h-4 text-primary" />}
                {docType === "lab" ? "Lab Manual Mode" : "Assignment Mode"}
              </h4>
              <div className="inline-flex items-center rounded-full border border-border bg-muted/30 p-0.5 shrink-0" role="group" aria-label="Output format">
                {(["docx", "pdf"] as const).map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setOutputFormat(f)}
                    className={`px-2.5 py-1 rounded-full text-[11px] font-semibold uppercase transition-all ${
                      outputFormat === f
                        ? "gradient-button text-primary-foreground"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {f}
                  </button>
                ))}
              </div>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              {docType === "lab"
                ? "Generates: Cover Page → TOC → All Tasks (Code + Output) → Conclusion"
                : "Generates: Cover Page → TOC → Content with Code Blocks → References"}
            </p>
            <div className="flex flex-wrap gap-1.5 mt-2">
              {["Cover Page", "Table of Contents", "Page Numbers", "Code Formatting", "Clean DOCX"].map(f => (
                <span key={f} className="text-[10px] px-2 py-0.5 rounded-full bg-primary/15 text-primary border border-primary/20 font-medium">{f}</span>
              ))}
            </div>
          </div>
        </div>

        {/* Preview */}
        <div className="lg:col-span-2 glass rounded-2xl p-6 overflow-y-auto" style={{ maxHeight: "700px" }}>
          {isGenerating && !content ? (
            <ThinkingAnimation message="UniGenius is generating your document..." />
          ) : content ? (
            <div className="flex gap-3">
              <div className="w-8 h-8 rounded-xl gradient-primary flex items-center justify-center flex-shrink-0">
                <Bot className="w-4 h-4 text-primary-foreground" />
              </div>
              <div className="text-sm text-foreground leading-relaxed min-w-0 flex-1">
                <MarkdownMessage content={content} />
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-center gap-4 py-16">
              <div className="w-14 h-14 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center">
                <FileText className="w-7 h-7 text-primary" />
              </div>
              <div>
                <p className="font-display font-semibold text-foreground">Document Preview</p>
                <p className="text-sm text-muted-foreground mt-1">
                  {docType === "lab"
                    ? "Configure your lab manual — generates a professional document with cover page, university header, student info, code blocks, and auto page numbering."
                    : "Configure your assignment — generates a professional document with cover page, TOC, academic formatting, references, and originality report."}
                </p>
              </div>
              <Button
                className="rounded-xl gradient-button text-primary-foreground gap-2"
                onClick={() => {
                  document.getElementById("docs-gen-form")?.scrollIntoView({ behavior: "smooth", block: "start" });
                  document.getElementById("docs-topic-input")?.focus({ preventScroll: true });
                }}
              >
                <FileText className="w-4 h-4" /> Generate your first document
              </Button>
            </div>
          )}
        </div>
        </div>
      </div>
    </PageShell>
  );
};

export default DocsGenPage;
