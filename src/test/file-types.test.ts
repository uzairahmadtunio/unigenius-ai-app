import { describe, it, expect } from "vitest";
import {
  getFileCategory,
  isFileAllowed,
  buildFileContentParts,
  ACCEPT_EXTENSIONS,
} from "@/lib/file-types";

// Upload pipeline classification (audit F-03): only formats the pipeline
// genuinely reads may be classified/allowed; ZIP/RAR and legacy Office
// formats were removed because nothing in the stack could read them.

describe("getFileCategory", () => {
  it("classifies by MIME type", () => {
    expect(getFileCategory("image/png")).toBe("image");
    expect(getFileCategory("application/pdf")).toBe("pdf");
    expect(
      getFileCategory("application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
    ).toBe("word");
    expect(
      getFileCategory("application/vnd.openxmlformats-officedocument.presentationml.presentation"),
    ).toBe("presentation");
    expect(getFileCategory("audio/mpeg")).toBe("audio");
    expect(getFileCategory("video/mp4")).toBe("video");
    expect(getFileCategory("text/plain")).toBe("text");
    expect(getFileCategory("application/rtf")).toBe("text");
  });

  it("classifies by file extension when MIME is missing/generic", () => {
    expect(getFileCategory("photo.JPG")).toBe("image");
    expect(getFileCategory("notes.pdf")).toBe("pdf");
    expect(getFileCategory("letter.docx")).toBe("word");
    expect(getFileCategory("slides.pptx")).toBe("presentation");
    expect(getFileCategory("song.mp3")).toBe("audio");
    expect(getFileCategory("clip.mov")).toBe("video");
    expect(getFileCategory("readme.md")).toBe("text");
    expect(getFileCategory("page.rtf")).toBe("text");
  });

  it("falls back to 'document' for unknown types", () => {
    expect(getFileCategory("application/zip")).toBe("document");
    expect(getFileCategory("application/octet-stream")).toBe("document");
  });
});

describe("isFileAllowed", () => {
  const f = (name: string, type: string) => new File(["x"], name, { type });

  it("allows every format the pipeline reads, by MIME", () => {
    expect(isFileAllowed(f("a.pdf", "application/pdf"))).toBe(true);
    expect(isFileAllowed(f("a.png", "image/png"))).toBe(true);
    expect(isFileAllowed(f("a.mp3", "audio/mpeg"))).toBe(true);
    expect(isFileAllowed(f("a.mp4", "video/mp4"))).toBe(true);
  });

  it("falls back to the extension when the browser reports no MIME", () => {
    expect(isFileAllowed(f("notes.docx", ""))).toBe(true);
    expect(isFileAllowed(f("slides.pptx", ""))).toBe(true);
    expect(isFileAllowed(f("readme.md", ""))).toBe(true);
  });

  it("rejects ZIP/RAR — accepted nowhere in the honest pipeline", () => {
    expect(isFileAllowed(f("bundle.zip", "application/zip"))).toBe(false);
    expect(isFileAllowed(f("bundle.rar", ""))).toBe(false);
  });

  it("rejects legacy .doc/.ppt binaries that cannot be read", () => {
    expect(isFileAllowed(f("old.doc", ""))).toBe(false);
    expect(isFileAllowed(f("old.ppt", ""))).toBe(false);
  });

  it("rejects files with no usable name or type", () => {
    expect(isFileAllowed(f("noext", ""))).toBe(false);
  });

  it("keeps the accept attribute in sync with the readable formats", () => {
    for (const ext of [".pdf", ".docx", ".pptx", ".txt", ".md", ".rtf", ".mp3", ".mp4"]) {
      expect(ACCEPT_EXTENSIONS).toContain(ext);
    }
    expect(ACCEPT_EXTENSIONS).not.toContain(".zip");
    expect(ACCEPT_EXTENSIONS).not.toContain(".doc,");
  });
});

describe("buildFileContentParts", () => {
  it("sends images as image_url parts plus an OCR instruction", async () => {
    const parts = await buildFileContentParts(
      { name: "diagram.png", type: "image/png", dataUrl: "data:image/png;base64,AAA" },
      0,
      1,
    );
    expect(parts[0]).toEqual({ type: "image_url", image_url: { url: "data:image/png;base64,AAA" } });
    expect(parts[1].type).toBe("text");
    expect((parts[1] as any).text).toContain("Analyze this image");
    expect((parts[1] as any).text).toContain("1/1: diagram.png");
  });

  it("adds the subject context to the instruction when provided", async () => {
    const parts = await buildFileContentParts(
      { name: "diagram.png", type: "image/png", dataUrl: "data:image/png;base64,AAA" },
      0,
      2,
      "Physics",
    );
    expect((parts[1] as any).text).toContain("for Physics");
    expect((parts[1] as any).text).toContain("1/2: diagram.png");
  });

  it("sends PDFs as inline file parts with the base64 payload only", async () => {
    const parts = await buildFileContentParts(
      { name: "paper.pdf", type: "application/pdf", dataUrl: "data:application/pdf;base64,QUJD" },
      0,
      1,
    );
    expect(parts[0]).toEqual({
      type: "file",
      file: { name: "paper.pdf", mime_type: "application/pdf", data: "QUJD" },
    });
    expect((parts[1] as any).text).toContain("Read and analyze this PDF");
  });

  it("embeds genuinely extracted text for text files, wrapped in delimiters", async () => {
    const real = new File(["EXTRACTED BODY"], "notes.txt", { type: "text/plain" });
    const parts = await buildFileContentParts(
      { name: "notes.txt", type: "text/plain", dataUrl: "", file: real },
      0,
      1,
    );
    expect(parts).toHaveLength(1);
    const text = (parts[0] as any).text as string;
    expect(text).toContain("----- BEGIN FILE TEXT -----");
    expect(text).toContain("EXTRACTED BODY");
    expect(text).toContain("----- END FILE TEXT -----");
    expect(text).not.toContain("only the first part");
  });

  it("marks truncated extractions with an honest note", async () => {
    const real = new File(["z".repeat(70_000)], "big.txt", { type: "text/plain" });
    const parts = await buildFileContentParts(
      { name: "big.txt", type: "text/plain", dataUrl: "", file: real },
      0,
      1,
    );
    expect((parts[0] as any).text).toContain("only the first part of its text is included");
  });

  it("falls back to an honest 'could not be read' note for Word files without a File handle", async () => {
    const parts = await buildFileContentParts(
      {
        name: "cv.docx",
        type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        dataUrl: "data:application/octet-stream;base64,AAA",
      },
      0,
      1,
    );
    expect(parts).toHaveLength(1);
    expect((parts[0] as any).text).toContain("could not be extracted");
  });

  it("sends audio as a file part with a transcription instruction", async () => {
    const parts = await buildFileContentParts(
      { name: "lecture.mp3", type: "audio/mpeg", dataUrl: "data:audio/mpeg;base64,AAA" },
      0,
      1,
    );
    expect(parts[0].type).toBe("file");
    expect((parts[1] as any).text).toContain("Transcribe it");
  });

  it("sends video as a file part with an analysis instruction", async () => {
    const parts = await buildFileContentParts(
      { name: "demo.mp4", type: "video/mp4", dataUrl: "data:video/mp4;base64,AAA" },
      0,
      1,
    );
    expect(parts[0].type).toBe("file");
    expect((parts[1] as any).text).toContain("Analyze its content");
  });
});
