import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { requireAuth } from "../_shared/auth.ts";
import { callGeminiWithRotation } from "../_shared/ai-failover.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Image generation now goes through the shared key pool first
// (callGeminiWithRotation — DB-managed keys in private.api_keys with
// env-secret fallback, per-key health/cooldown handled centrally).
// The Lovable AI Gateway remains as a fallback when the pool has no
// usable key (e.g. nothing seeded yet) and LOVABLE_API_KEY exists.
// Try Nano Banana 2 first (best quality + fast), fall back to 2.5-flash-image.
const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/images/generations";
const IMAGE_MODELS = [
  "google/gemini-3.1-flash-image", // Nano Banana 2
  "google/gemini-2.5-flash-image", // Nano Banana 1
];
// Same models on the direct Gemini API (pool path).
const POOL_IMAGE_MODELS = [
  "gemini-3.1-flash-image",
  "gemini-2.5-flash-image",
];

/**
 * Generate an image via the shared Gemini key pool (direct REST
 * generateContent with IMAGE response modality). Returns null when the
 * pool cannot produce an image so the caller can fall back to the gateway.
 */
async function generateImageViaPool(prompt: string): Promise<{ base64: string; mimeType: string; model: string } | null> {
  for (const model of POOL_IMAGE_MODELS) {
    try {
      const result = await callGeminiWithRotation(
        model,
        {
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
        },
        false,
      );
      if (!result || !result.response.ok) {
        if (result) {
          console.warn(`generate-slide-image: pool model ${model} returned ${result.response.status}`);
          await result.response.text().catch(() => "");
        }
        continue;
      }
      const data = await result.response.json();
      const parts = data?.candidates?.[0]?.content?.parts || [];
      for (const part of parts) {
        const inline = part.inlineData || part.inline_data;
        if (inline?.data) {
          return {
            base64: inline.data,
            mimeType: inline.mimeType || inline.mime_type || "image/png",
            model,
          };
        }
      }
      console.warn(`generate-slide-image: pool model ${model} returned no image part`);
    } catch (e) {
      console.warn(`generate-slide-image: pool model ${model} threw:`, e);
    }
  }
  return null;
}

async function generateImageViaGateway(prompt: string, apiKey: string): Promise<{ base64: string; mimeType: string; model: string }> {
  let lastErr = "";
  for (const model of IMAGE_MODELS) {
    try {
      const res = await fetch(GATEWAY_URL, {
        method: "POST",
        headers: {
          "Lovable-API-Key": apiKey,
          "X-Lovable-AIG-SDK": "edge-fetch",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: prompt }],
          modalities: ["image", "text"],
        }),
      });
      if (!res.ok) {
        const txt = await res.text();
        lastErr = `[${model}] ${res.status}: ${txt.slice(0, 300)}`;
        console.warn(lastErr);
        // 4xx on this model -> try next model; 5xx -> also try next model
        continue;
      }
      const data = await res.json();
      const b64 = data?.data?.[0]?.b64_json;
      if (!b64) {
        lastErr = `[${model}] no b64_json in response: ${JSON.stringify(data).slice(0, 300)}`;
        console.warn(lastErr);
        continue;
      }
      return { base64: b64, mimeType: "image/png", model };
    } catch (e) {
      lastErr = `[${model}] ${e instanceof Error ? e.message : String(e)}`;
      console.warn(lastErr);
    }
  }
  throw new Error(`All Lovable AI image attempts failed. Last: ${lastErr}`);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const auth = await requireAuth(req, corsHeaders);
  if (auth instanceof Response) return auth;

  try {
    const { prompt, slideIndex, sessionId } = await req.json();

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) throw new Error("Supabase not configured");

    const imagePrompt = `A professional, polished presentation slide illustration depicting: ${prompt}. Modern editorial style, clean composition, vibrant but tasteful colors, photorealistic or premium 3D render, suitable as a hero image inside a corporate/academic slide. No embedded text, no captions, no watermarks. 16:9 friendly framing.`;

    // Pool first (DB-managed keys); Lovable Gateway only as fallback.
    let generated = await generateImageViaPool(imagePrompt);
    if (!generated) {
      if (!LOVABLE_API_KEY) {
        throw new Error("No image provider available: key pool exhausted and LOVABLE_API_KEY is not configured");
      }
      generated = await generateImageViaGateway(imagePrompt, LOVABLE_API_KEY);
    }
    const { base64, mimeType, model } = generated;
    console.log(`generate-slide-image: used ${model}`);

    const ext = mimeType.includes("jpeg") ? "jpg" : "png";
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const filePath = `${sessionId}/slide-${slideIndex}.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from("slide-images")
      .upload(filePath, bytes, { contentType: mimeType, upsert: true });

    if (uploadError) {
      console.error("Upload error:", uploadError);
      throw new Error("Failed to upload image");
    }

    const { data: urlData } = supabase.storage.from("slide-images").getPublicUrl(filePath);

    return new Response(JSON.stringify({ imageUrl: urlData.publicUrl, model }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("generate-slide-image error:", e);
    const msg = e instanceof Error ? e.message : "Unknown error";
    const status = msg.includes("Rate") || msg.includes("429") ? 429 : 500;
    return new Response(JSON.stringify({ error: msg }), {
      status, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
