import { describe, it, expect } from "vitest";
import { normSubject, bookDownloadUrl, type LibraryBook } from "@/lib/notes-reader";

// Subject matching across the app depends on normSubject: the same
// subject arrives as "Object-Oriented Programming (OOP)", "OOP", or
// "Introduction to …" from different sources and must reconcile.

describe("normSubject", () => {
  it("lowercases and strips parenthesised abbreviations", () => {
    expect(normSubject("Object-Oriented Programming (OOP)")).toBe("object oriented programming");
    expect(normSubject("Digital Logic Design (DLD)")).toBe("digital logic design");
  });

  it("strips a leading 'Introduction to'", () => {
    expect(normSubject("Introduction to Computing")).toBe("computing");
    expect(normSubject("Introduction to Programming Fundamentals")).toBe("programming fundamentals");
  });

  it("collapses punctuation and repeated whitespace", () => {
    expect(normSubject("  Data   Structures & Algorithms ")).toBe("data structures algorithms");
    expect(normSubject("Statistics & Probability")).toBe("statistics probability");
  });

  it("keeps digits", () => {
    expect(normSubject("CS 101")).toBe("cs 101");
  });
});

describe("bookDownloadUrl", () => {
  const book = (partial: Partial<LibraryBook>): LibraryBook =>
    ({
      id: "b1",
      subject: "OOP",
      semester: 2,
      title: "T",
      author: "A",
      source: "S",
      license: "CC",
      hosted_url: null,
      official_url: null,
      size_mb: null,
      page_count: null,
      ...partial,
    }) as LibraryBook;

  it("converts a Drive preview link into a direct download link", () => {
    const b = book({ hosted_url: "https://drive.google.com/file/d/ABC123xyz/view?usp=sharing" });
    expect(bookDownloadUrl(b)).toBe("https://drive.google.com/uc?export=download&id=ABC123xyz");
  });

  it("passes non-Drive hosted URLs through unchanged", () => {
    const b = book({ hosted_url: "https://cdn.example.com/book.pdf" });
    expect(bookDownloadUrl(b)).toBe("https://cdn.example.com/book.pdf");
  });

  it("falls back to the official URL when nothing is hosted", () => {
    const b = book({ hosted_url: null, official_url: "https://publisher.example/book" });
    expect(bookDownloadUrl(b)).toBe("https://publisher.example/book");
  });

  it("returns null when the book has no URL at all", () => {
    expect(bookDownloadUrl(book({}))).toBeNull();
  });
});
