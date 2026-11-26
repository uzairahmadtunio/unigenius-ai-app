import { describe, it, expect, vi, afterEach } from "vitest";
import { driveFileId, fileKind, previewUrl, directDownloadUrl, downloadName, sourceFromTitle, downloadFile } from "@/lib/file-delivery";

describe("downloadFile — web resources never eject the app tab (D-2)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("opens a web-page resource in a NEW TAB and never fetches it as a file", async () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await downloadFile("https://ocw.mit.edu/courses/6-0001/", "MIT OCW page");
    expect(open).toHaveBeenCalledWith(
      "https://ocw.mit.edu/courses/6-0001/",
      "_blank",
      "noopener,noreferrer",
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("still downloads real files (PDF) through the blob path", async () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    const blob = new Blob(["%PDF"], { type: "application/pdf" });
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, blob: async () => blob } as any)));
    const createUrl = vi.fn(() => "blob:fake");
    const revoke = vi.fn();
    (URL as any).createObjectURL = createUrl;
    (URL as any).revokeObjectURL = revoke;
    await downloadFile("https://x.edu/a.pdf", "a.pdf");
    expect(createUrl).toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });
});

describe("driveFileId", () => {
  it("extracts ids from every Drive URL shape", () => {
    expect(driveFileId("https://drive.google.com/file/d/1AbC_dEf/view?usp=sharing")).toBe("1AbC_dEf");
    expect(driveFileId("https://drive.google.com/uc?export=download&id=1upyepmp2YY7WvEd9x0Sl")).toBe("1upyepmp2YY7WvEd9x0Sl");
    expect(driveFileId("https://drive.google.com/open?id=XYZ123")).toBe("XYZ123");
  });
  it("returns null for non-Drive URLs", () => {
    expect(driveFileId("https://ocw.mit.edu/courses/6-0001/?id=5")).toBeNull();
    expect(driveFileId("")).toBeNull();
  });
});

describe("preview / download URLs", () => {
  it("Drive files preview via the embed endpoint and download via uc", () => {
    const u = "https://drive.google.com/file/d/ABC123/view";
    expect(previewUrl(u)).toBe("https://drive.google.com/file/d/ABC123/preview");
    expect(directDownloadUrl(u)).toBe("https://drive.google.com/uc?export=download&id=ABC123");
  });
  it("non-Drive URLs pass through unchanged", () => {
    const u = "https://example.com/paper.pdf";
    expect(previewUrl(u)).toBe(u);
    expect(directDownloadUrl(u)).toBe(u);
  });
  it("Supabase storage URLs gain a download disposition param", () => {
    const u = "https://proj.supabase.co/storage/v1/object/public/notes/u1/file.pdf";
    expect(directDownloadUrl(u, "My Notes.pdf")).toBe(`${u}?download=My%20Notes.pdf`);
  });
});

describe("fileKind / downloadName / sourceFromTitle", () => {
  it("classifies kinds", () => {
    expect(fileKind("https://drive.google.com/file/d/X/view")).toBe("drive");
    expect(fileKind("https://x.edu/a.pdf")).toBe("pdf");
    expect(fileKind("https://x.edu/page")).toBe("web");
    expect(fileKind("https://x.edu/get", "scan.JPG")).toBe("image");
  });
  it("builds a safe filename, preferring a real file_name with extension", () => {
    expect(downloadName("Whatever", "notes.pdf")).toBe("notes.pdf");
    expect(downloadName("DLD: Gates & More?", null, "https://x.edu/a.pdf")).toBe("DLD Gates & More.pdf");
  });
  it("extracts the source segment from seeded titles", () => {
    expect(sourceFromTitle("Think Python, 2nd Edition — Free Textbook (Allen B. Downey)")).toBe("Free Textbook (Allen B. Downey)");
    expect(sourceFromTitle("DBMS Notes Module 8 — ER & Normalization (NPTEL PDF)")).toBe("ER & Normalization (NPTEL PDF)");
    expect(sourceFromTitle("Plain title without source")).toBeNull();
  });
});
