import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import { extractTextFromFile } from "@/lib/extract-text";

// Real behaviour tests for the client-side extraction layer (audit F-03):
// Office/text formats must be genuinely READ in the browser, unsupported
// formats must honestly return null, and long documents must be capped.

const fileOf = (content: string | ArrayBuffer, name: string) =>
  new File([content as any], name);

describe("extractTextFromFile — plain text formats", () => {
  it("reads a .txt file verbatim", async () => {
    const res = await extractTextFromFile(fileOf("Hello study notes", "notes.txt"));
    expect(res).toEqual({ text: "Hello study notes", truncated: false });
  });

  it("reads a .md file", async () => {
    const res = await extractTextFromFile(fileOf("# Title\n\nSome **markdown**", "doc.md"));
    expect(res?.text).toBe("# Title\n\nSome **markdown**");
    expect(res?.truncated).toBe(false);
  });

  it("collapses 3+ blank lines and trims", async () => {
    const res = await extractTextFromFile(fileOf("  a\n\n\n\n\nb  ", "n.txt"));
    expect(res?.text).toBe("a\n\nb");
  });

  it("caps very long text at 60,000 chars and flags truncation", async () => {
    const res = await extractTextFromFile(fileOf("a".repeat(70_000), "big.txt"));
    expect(res?.truncated).toBe(true);
    expect(res?.text).toHaveLength(60_000);
  });

  it("does not flag text exactly at the cap as truncated", async () => {
    const res = await extractTextFromFile(fileOf("b".repeat(60_000), "exact.txt"));
    expect(res?.truncated).toBe(false);
    expect(res?.text).toHaveLength(60_000);
  });
});

describe("extractTextFromFile — RTF", () => {
  it("strips RTF control words and converts \\par to newlines", async () => {
    const res = await extractTextFromFile(fileOf("{\\rtf1\\ansi Hello\\par World}", "a.rtf"));
    expect(res?.text).toBe("Hello\nWorld");
  });

  it("removes hex escapes and braces", async () => {
    const res = await extractTextFromFile(fileOf("{\\rtf1 Caf\\'e9 notes}", "b.rtf"));
    expect(res?.text).not.toContain("\\");
    expect(res?.text).not.toContain("{");
    expect(res?.text).toContain("Caf");
    expect(res?.text).toContain("notes");
  });
});

describe("extractTextFromFile — unsupported / native formats", () => {
  it("returns null for PDF (read natively by the model, not extracted)", async () => {
    expect(await extractTextFromFile(fileOf("%PDF-1.4 fake", "x.pdf"))).toBeNull();
  });

  it("returns null for ZIP (no extraction path — must not be accepted upstream)", async () => {
    expect(await extractTextFromFile(fileOf("PK\x03\x04", "x.zip"))).toBeNull();
  });

  it("returns null for an unknown extension", async () => {
    expect(await extractTextFromFile(fileOf("data", "x.xyz"))).toBeNull();
  });

  it("returns null instead of throwing for a corrupt DOCX", async () => {
    const res = await extractTextFromFile(fileOf("this is not a zip at all", "broken.docx"));
    expect(res).toBeNull();
  });
});

describe("extractTextFromFile — real Office documents", () => {
  it("extracts text from a real DOCX built as an OOXML zip", async () => {
    const zip = new JSZip();
    zip.file(
      "[Content_Types].xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
    );
    zip.folder("_rels")!.file(
      ".rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
    );
    zip.folder("word")!.file(
      "document.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Hello DOCX world</w:t></w:r></w:p></w:body></w:document>`,
    );
    const buf = await zip.generateAsync({ type: "arraybuffer" });
    const res = await extractTextFromFile(fileOf(buf, "real.docx"));
    expect(res?.text).toBe("Hello DOCX world");
    expect(res?.truncated).toBe(false);
  });

  it("extracts PPTX slides in numeric order and decodes XML entities", async () => {
    const zip = new JSZip();
    // Deliberately added out of order: slide2 before slide1.
    zip.file("ppt/slides/slide2.xml", `<p:sld><a:t>Second slide</a:t></p:sld>`);
    zip.file("ppt/slides/slide10.xml", `<p:sld><a:t>Tenth slide</a:t></p:sld>`);
    zip.file("ppt/slides/slide1.xml", `<p:sld><a:t>First &amp; foremost</a:t><a:t>Line &lt;two&gt;</a:t></p:sld>`);
    const buf = await zip.generateAsync({ type: "arraybuffer" });
    const res = await extractTextFromFile(fileOf(buf, "deck.pptx"));
    expect(res?.text).toBe(
      "--- Slide 1 ---\nFirst & foremost\nLine <two>\n\n--- Slide 2 ---\nSecond slide\n\n--- Slide 3 ---\nTenth slide",
    );
  });

  it("returns empty text for a PPTX with no slides", async () => {
    const zip = new JSZip();
    zip.file("ppt/presentation.xml", `<p:presentation/>`);
    const buf = await zip.generateAsync({ type: "arraybuffer" });
    const res = await extractTextFromFile(fileOf(buf, "empty.pptx"));
    expect(res?.text).toBe("");
    expect(res?.truncated).toBe(false);
  });
});
