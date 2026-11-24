import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { requireAuth } from "../_shared/auth.ts";
import { generateContentWithFailover } from "../_shared/ai-failover.ts";
import { enforceBodySize, clampString } from "../_shared/limits.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Expose-Headers": "x-ai-tier, x-ai-key-index",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const auth = await requireAuth(req, corsHeaders);
  if (auth instanceof Response) return auth;

  const tooBig = enforceBodySize(req, corsHeaders, 12_000_000);
  if (tooBig) return tooBig;

  try {
    const body = await req.json();
    const subject = clampString(body.subject, 200);
    const content = clampString(body.content, 30_000);
    const count = Math.min(Math.max(Number(body.count) || 10, 1), 30);
    // Uploaded binary file (PDF / image) as base64 or data URL — read by
    // Gemini directly so cards come from the file's real content.
    const fileData = typeof body.fileData === "string" ? body.fileData : "";
    const fileType = clampString(body.fileType, 100);
    const fileName = clampString(body.fileName, 200);
    const hasFile = Boolean(fileData && fileType);

    let systemText: string;
    const parts: any[] = [];
    if (hasFile) {
      systemText = `You are a flashcard generator for university students. Generate exactly ${count} flashcards based ONLY on the content of the uploaded file${subject ? ` (subject context: "${subject}")` : ""}. Every card must come from facts, definitions, formulas, or concepts that actually appear in this file — do NOT invent cards from general curriculum knowledge. If a fact is not in the file, do not make a card about it.`;
      const base64 = fileData.startsWith("data:") ? fileData.split(",")[1] : fileData;
      parts.push({ inline_data: { mime_type: fileType, data: base64 } });
      parts.push({ text: `Read this uploaded file (${fileName || "material"}) carefully and generate exactly ${count} flashcards from its content only. Front: a specific question about the file's content. Back: the answer, taken from the file.` });
    } else {
      systemText = `You are a flashcard generator for university students. Generate exactly ${count || 10} flashcards for the subject "${subject}".
${content ? `Use the following uploaded material as the ONLY source — every card must come from this material, do not add facts from general knowledge:\n${content}` : `Generate flashcards covering the most important concepts, definitions, and formulas for "${subject}".`}`;
      parts.push({ text: content ? `Generate flashcards from this material for ${subject}` : `Generate flashcards for ${subject}` });
    }

    const toolDecl = {
      function_declarations: [{
        name: "suggest_flashcards",
        description: "Return flashcards with front (question) and back (answer)",
        parameters: {
          type: "OBJECT",
          properties: {
            cards: {
              type: "ARRAY",
              items: {
                type: "OBJECT",
                properties: {
                  front: { type: "STRING" },
                  back: { type: "STRING" },
                },
                required: ["front", "back"],
              },
            },
          },
          required: ["cards"],
        },
      }],
    };

    const result = await generateContentWithFailover({
      modelPath: "gemini-3.5-flash",
      geminiBody: {
        system_instruction: { parts: [{ text: systemText }] },
        contents: [{ role: "user", parts }],
        tools: [toolDecl],
        tool_config: { function_calling_config: { mode: "ANY", allowed_function_names: ["suggest_flashcards"] } },
      },
      corsHeaders,
    });
    if (result instanceof Response) return result;

    const fc = result.data.candidates?.[0]?.content?.parts?.find((p: any) => p.functionCall);
    const headers = {
      ...corsHeaders,
      "Content-Type": "application/json",
      "x-ai-tier": result.tier,
      "x-ai-key-index": String(result.keyIndex),
    };
    if (fc) {
      return new Response(JSON.stringify(fc.functionCall.args), { headers });
    }
    return new Response(JSON.stringify({ cards: [] }), { headers });
  } catch (e) {
    console.error("flashcard error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
