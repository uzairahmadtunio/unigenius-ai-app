import { supabase } from "@/integrations/supabase/client";

/**
 * Storage URL helpers for PRIVATE buckets.
 *
 * Older rows store a full public URL (…/object/public/<bucket>/<path>) and
 * newer code may store a bare path. Both forms are accepted here: the object
 * path is extracted and a fresh signed URL is created, so private buckets
 * keep working everywhere a stored URL is displayed.
 */
export function storagePathFromUrl(bucket: string, urlOrPath: string): string | null {
  if (!urlOrPath) return null;
  const marker = `/object/public/${bucket}/`;
  const idx = urlOrPath.indexOf(marker);
  if (idx >= 0) return decodeURIComponent(urlOrPath.slice(idx + marker.length));
  const signMarker = `/object/sign/${bucket}/`;
  const sIdx = urlOrPath.indexOf(signMarker);
  if (sIdx >= 0) {
    const rest = urlOrPath.slice(sIdx + signMarker.length);
    return decodeURIComponent(rest.split("?")[0]);
  }
  if (!urlOrPath.startsWith("http")) return urlOrPath; // already a bare path
  return null; // some other URL — leave untouched
}

export async function signedStorageUrl(
  bucket: string,
  urlOrPath: string,
  expiresIn = 3600,
): Promise<string> {
  const path = storagePathFromUrl(bucket, urlOrPath);
  if (!path) return urlOrPath;
  const { data } = await supabase.storage.from(bucket).createSignedUrl(path, expiresIn);
  return data?.signedUrl || urlOrPath;
}

export async function signStorageUrls(
  bucket: string,
  urls: string[],
  expiresIn = 3600,
): Promise<string[]> {
  if (!urls.length) return urls;
  const paths = urls.map((u) => storagePathFromUrl(bucket, u));
  const toSign = paths.filter((p): p is string => !!p);
  if (!toSign.length) return urls;
  const { data } = await supabase.storage.from(bucket).createSignedUrls(toSign, expiresIn);
  const byPath = new Map<string, string>();
  (data || []).forEach((d) => {
    if (d?.path && d?.signedUrl) byPath.set(d.path, d.signedUrl);
  });
  return urls.map((u, i) => {
    const p = paths[i];
    return (p && byPath.get(p)) || u;
  });
}
