import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the supabase storage client before importing the module under test.
const h = vi.hoisted(() => ({
  signedUrlResult: { data: { signedUrl: "https://signed.example/abc" } } as any,
  signedUrlsResult: { data: [] as any[] } as any,
  createSignedUrl: vi.fn(),
  createSignedUrls: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    storage: {
      from: () => ({
        createSignedUrl: h.createSignedUrl,
        createSignedUrls: h.createSignedUrls,
      }),
    },
  },
}));

import { storagePathFromUrl, signedStorageUrl, signStorageUrls } from "@/lib/storage";

beforeEach(() => {
  vi.clearAllMocks();
  h.createSignedUrl.mockResolvedValue(h.signedUrlResult);
  h.createSignedUrls.mockResolvedValue(h.signedUrlsResult);
});

describe("storagePathFromUrl", () => {
  it("returns null for empty input", () => {
    expect(storagePathFromUrl("avatars", "")).toBeNull();
  });

  it("extracts the object path from a stored public URL", () => {
    expect(
      storagePathFromUrl(
        "chat-uploads",
        "https://proj.supabase.co/storage/v1/object/public/chat-uploads/user1/file.pdf",
      ),
    ).toBe("user1/file.pdf");
  });

  it("URL-decodes encoded paths", () => {
    expect(
      storagePathFromUrl("notes", "https://x/object/public/notes/my%20file.pdf"),
    ).toBe("my file.pdf");
  });

  it("extracts the path from a signed URL and drops the token query", () => {
    expect(
      storagePathFromUrl("notes", "https://x/object/sign/notes/a/b.pdf?token=secret"),
    ).toBe("a/b.pdf");
  });

  it("passes bare paths through unchanged", () => {
    expect(storagePathFromUrl("notes", "user1/file.pdf")).toBe("user1/file.pdf");
  });

  it("returns null for a foreign URL so it is left untouched", () => {
    expect(storagePathFromUrl("notes", "https://example.com/other/file.pdf")).toBeNull();
  });

  it("does not confuse buckets: a URL for another bucket is not extracted", () => {
    expect(
      storagePathFromUrl("avatars", "https://x/object/public/notes/file.pdf"),
    ).toBeNull();
  });
});

describe("signedStorageUrl", () => {
  it("signs a bare path via the storage API", async () => {
    const out = await signedStorageUrl("notes", "user1/file.pdf", 600);
    expect(h.createSignedUrl).toHaveBeenCalledWith("user1/file.pdf", 600);
    expect(out).toBe("https://signed.example/abc");
  });

  it("leaves foreign URLs untouched and never calls the API", async () => {
    const url = "https://example.com/other/file.pdf";
    expect(await signedStorageUrl("notes", url)).toBe(url);
    expect(h.createSignedUrl).not.toHaveBeenCalled();
  });

  it("falls back to the original value when signing yields nothing", async () => {
    h.createSignedUrl.mockResolvedValue({ data: null });
    expect(await signedStorageUrl("notes", "user1/file.pdf")).toBe("user1/file.pdf");
  });
});

describe("signStorageUrls", () => {
  it("returns the input unchanged for an empty list", async () => {
    expect(await signStorageUrls("notes", [])).toEqual([]);
    expect(h.createSignedUrls).not.toHaveBeenCalled();
  });

  it("replaces signable entries and keeps foreign URLs in place", async () => {
    h.createSignedUrls.mockResolvedValue({
      data: [
        { path: "a.pdf", signedUrl: "https://signed/a" },
        { path: "b.pdf", signedUrl: "https://signed/b" },
      ],
    });
    const out = await signStorageUrls("notes", [
      "https://x/object/public/notes/a.pdf",
      "https://example.com/keep.pdf",
      "b.pdf",
    ]);
    expect(out).toEqual(["https://signed/a", "https://example.com/keep.pdf", "https://signed/b"]);
  });

  it("keeps originals when the API returns no signed URL for a path", async () => {
    h.createSignedUrls.mockResolvedValue({ data: [{ path: "a.pdf", signedUrl: null }] });
    const out = await signStorageUrls("notes", ["a.pdf"]);
    expect(out).toEqual(["a.pdf"]);
  });
});
