import { describe, expect, it } from "vitest";
import {
  canonicalFor,
  extractHeadings,
  extractSummary,
  metaDescription,
  slugify,
  stripMarkdown,
} from "@/lib/seo";

describe("seo helpers", () => {
  it("builds canonical URLs", () => {
    expect(canonicalFor("/")).toBe("https://unigenius.vercel.app/");
    expect(canonicalFor("/lectures")).toBe("https://unigenius.vercel.app/lectures");
    expect(canonicalFor("topics")).toBe("https://unigenius.vercel.app/topics");
  });

  it("slugifies subject names the same way the sitemap generator does", () => {
    expect(slugify("Object Oriented Programming")).toBe("object-oriented-programming");
    expect(slugify("Data Structures and Algorithms (DSA)")).toBe("data-structures-and-algorithms-dsa");
    expect(slugify("Human Computer Interaction (HCI)")).toBe("human-computer-interaction-hci");
    expect(slugify("Software Project Management (SPM)")).toBe("software-project-management-spm");
  });

  it("extracts the locked short summary without editing it", () => {
    const body =
      "*Short summary: OOP mein hum program ko objects ki duniya ki tarah sochte hain.*\n\n## From procedures to objects\n\nBody text.";
    expect(extractSummary(body)).toBe(
      "OOP mein hum program ko objects ki duniya ki tarah sochte hain.",
    );
  });

  it("falls back to the first paragraph when there is no summary line", () => {
    expect(extractSummary("A plain first paragraph.\n\n## Next")).toBe("A plain first paragraph.");
  });

  it("strips markdown for meta text", () => {
    expect(stripMarkdown("## Title\n\nSome **bold** and [a link](https://x.y) here.")).toBe(
      "Title Some bold and a link here.",
    );
  });

  it("clamps meta descriptions on a word boundary", () => {
    const long = "word ".repeat(60).trim();
    const out = metaDescription(long, 100);
    expect(out.length).toBeLessThanOrEqual(100);
    expect(out.endsWith("…")).toBe(true);
    expect(metaDescription("short text")).toBe("short text");
  });

  it("extracts H2/H3 headings for the preview contents list", () => {
    const body = "# Title\n\n## What is a class?\n\nText\n\n### Details\n\n## Objects";
    expect(extractHeadings(body)).toEqual(["What is a class?", "Details", "Objects"]);
  });
});
