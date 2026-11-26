// Gemini TTS (TTS Upgrade, 2026-11-26) — Read Aloud with Google AI
// Studio's prebuilt voices (Charon, Kore, …) instead of the device's
// robotic Web Speech voices. Uzair's verdict on the 25 Nov device-voice
// fix was final: still robotic. This function is the primary path; the
// frontend silently falls back to Web Speech when this returns an
// error (quota exhausted, offline, signed out).
//
// POST { text, voice } → { audio: <base64 WAV>, mimeType: "audio/wav", voice }
// - Auth: logged-in users only (requireAuth).
// - Keys: the shared private.api_keys Gemini pool via
//   callGeminiWithRotation — a 429/quota on one key rotates to the next.
// - Gemini returns raw PCM (audio/L16;rate=24000); we wrap it in a WAV
//   header here so the browser can play it with a plain <audio> element.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { requireAuth } from "../_shared/auth.ts";
import { enforceBodySize, clampString } from "../_shared/limits.ts";
import { callGeminiWithRotation } from "../_shared/ai-failover.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const TTS_MODEL = "gemini-2.5-flash-preview-tts";

// The prebuilt voices the UI offers (must match src/lib/tts.ts).
const VOICES = new Set([
  "Charon", "Puck", "Fenrir", "Orus", // male
  "Kore", "Aoede", "Leda", "Callirrhoe", // female
]);
const DEFAULT_VOICE = "Kore";
// The frontend chunks at ~180 chars; anything far beyond one chunk is
// a misuse — clamp rather than burn quota on a book.
const MAX_TEXT = 800;

/** Wrap raw 16-bit mono PCM in a 44-byte WAV header. */
function pcmToWav(pcm: Uint8Array, sampleRate: number): Uint8Array {
  const wav = new Uint8Array(44 + pcm.length);
  const view = new DataView(wav.buffer);
  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + pcm.length, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate (16-bit mono)
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeStr(36, "data");
  view.setUint32(40, pcm.length, true);
  wav.set(pcm, 44);
  return wav;
}

function toBase64(bytes: Uint8Array): string {
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function jsonError(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const auth = await requireAuth(req, corsHeaders);
  if (auth instanceof Response) return auth;

  const tooBig = enforceBodySize(req, corsHeaders, 16_000);
  if (tooBig) return tooBig;

  try {
    const body = await req.json().catch(() => ({}));
    const text = clampString(body?.text, MAX_TEXT).trim();
    const voiceRaw = typeof body?.voice === "string" ? body.voice : "";
    const voice = VOICES.has(voiceRaw) ? voiceRaw : DEFAULT_VOICE;
    if (!text) return jsonError(400, "Nothing to read");

    const result = await callGeminiWithRotation(
      TTS_MODEL,
      {
        contents: [{ parts: [{ text }] }],
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } },
          },
        },
      },
      false,
      {
        // Speech for one ~180-char chunk is quick, but allow headroom so
        // a slow first key can rotate instead of timing the request out.
        attemptTimeoutMs: 30_000,
        deadlineMs: 75_000,
        // Some pool projects answer TTS with a 200 + finishReason OTHER
        // and NO audio — rotate past those keys instead of failing.
        acceptJson: (json: any) =>
          (json?.candidates?.[0]?.content?.parts ?? []).some((p: any) => !!p?.inlineData?.data),
      },
    );
    if (!result) {
      return jsonError(503, "Voice service is busy — all keys are cooling down");
    }
    if (!result.response.ok) {
      const detail = await result.response.text().catch(() => "");
      console.error(`tts: Gemini ${result.response.status}: ${detail.slice(0, 300)}`);
      return jsonError(502, "Voice generation failed");
    }

    const data = await result.response.json();
    const parts = data?.candidates?.[0]?.content?.parts ?? [];
    const audioPart = parts.find((p: any) => p?.inlineData?.data);
    if (!audioPart) {
      console.error("tts: no audio part in Gemini response", JSON.stringify(data).slice(0, 300));
      return jsonError(502, "Voice generation returned no audio");
    }
    const mime: string = audioPart.inlineData.mimeType || "audio/L16;rate=24000";
    const rateMatch = /rate=(\d+)/.exec(mime);
    const sampleRate = rateMatch ? Number(rateMatch[1]) : 24000;
    const pcm = fromBase64(audioPart.inlineData.data);
    if (!pcm.length) return jsonError(502, "Voice generation returned empty audio");
    const wav = pcmToWav(pcm, sampleRate);

    return new Response(
      JSON.stringify({ audio: toBase64(wav), mimeType: "audio/wav", voice }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("tts error:", e);
    return jsonError(500, "Voice generation failed");
  }
});
