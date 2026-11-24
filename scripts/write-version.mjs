// Post-build: stamp dist/version.json with the entry bundle hash that was
// actually built into dist/index.html. The in-app version guard
// (src/pwa/version-guard.ts) compares the running bundle's hash against this
// file to detect stale cached builds and self-heal them.
import { readFileSync, writeFileSync } from "node:fs";

try {
  const html = readFileSync("dist/index.html", "utf8");
  const m = html.match(/index-([A-Za-z0-9_-]+)\.js/);
  if (m) {
    writeFileSync("dist/version.json", JSON.stringify({ entry: m[1] }));
    console.log("[write-version] version.json entry =", m[1]);
  } else {
    console.warn("[write-version] entry bundle hash not found in dist/index.html");
  }
} catch (err) {
  console.warn("[write-version] skipped:", err.message);
}
