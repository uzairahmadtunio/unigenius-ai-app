// Streams a publicly-shared Google Drive file to the browser's <video>
// element. Drive's own preview player is poor on mobile (broken fullscreen,
// cut-off controls), and Drive's web download flow shows real browsers a
// virus-scan warning page for large files — so neither the preview embed
// nor the uc?export=download link can feed a native player.
//
// Working path (verified 2026-11-23): the Drive API media endpoint with a
// referrer-restricted API key (env DRIVE_STREAM_KEY, project
// unigenius-515415, key "UniGenius Drive Stream", Drive API only,
// referrers unigenius.vercel.app/* + *.vercel.app/*). It serves media
// directly with HTTP range support. We probe it server-side (with our
// site's Referer header, which the key restriction requires) and 302 the
// browser to it; the browser's own request carries the page referer.
// Fallbacks: the old confirm-token download flow, then 502 (the frontend
// then falls back to the Drive preview iframe).

export default async function handler(req, res) {
  const id = (req.query && req.query.id) || "";
  if (!/^[A-Za-z0-9_-]{10,}$/.test(id)) {
    res.status(400).send("bad id");
    return;
  }

  const send = (url) => {
    res.writeHead(302, { Location: url, "Cache-Control": "no-store" });
    res.end();
  };

  // Primary: Drive API alt=media.
  const key = process.env.DRIVE_STREAM_KEY;
  if (key) {
    const apiUrl = `https://www.googleapis.com/drive/v3/files/${id}?alt=media&key=${key}`;
    try {
      const probe = await fetch(apiUrl, {
        headers: {
          Range: "bytes=0-0",
          Referer: "https://unigenius.vercel.app/",
        },
        redirect: "manual",
      });
      const pct = probe.headers.get("content-type") || "";
      if (probe.status === 206 || probe.status === 200 || /^(video|audio)\//.test(pct)) {
        send(apiUrl);
        return;
      }
    } catch (e) {
      /* fall through to the legacy flow */
    }
  }

  // Fallback: legacy uc download + confirm-token dance (works for
  // non-browser agents; browsers may still hit the scan-warning page,
  // in which case the frontend's Drive-iframe fallback takes over).
  const uc = `https://drive.google.com/uc?export=download&id=${id}`;
  try {
    let target = null;
    const r1 = await fetch(uc, { redirect: "manual" });
    const loc = r1.headers.get("location");
    const ct1 = r1.headers.get("content-type") || "";
    if (loc) {
      const probe = await fetch(loc, {
        headers: { Range: "bytes=0-0" },
        redirect: "manual",
      });
      const pct = probe.headers.get("content-type") || "";
      if (/^(video|audio)\//.test(pct) || pct.includes("octet-stream")) {
        target = loc;
      } else {
        const html = await probe.text();
        const m = html.match(/name="uuid" value="([^"]+)"/);
        if (m) {
          target = `https://drive.usercontent.google.com/download?id=${id}&export=download&confirm=t&uuid=${m[1]}`;
        }
      }
    } else if (ct1.includes("text/html")) {
      const html = await r1.text();
      const m = html.match(/name="uuid" value="([^"]+)"/);
      if (m) {
        target = `https://drive.usercontent.google.com/download?id=${id}&export=download&confirm=t&uuid=${m[1]}`;
      }
    } else if (/^(video|audio)\//.test(ct1)) {
      target = uc;
    }
    if (!target) {
      res.status(502).send("stream unavailable");
      return;
    }
    send(target);
  } catch (e) {
    res.status(502).send("stream error");
  }
}
