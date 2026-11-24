// Unit tests for the OpenAI-compatible tier helpers in ai-failover.ts.
// Run: deno test --allow-env --allow-net supabase/functions/_shared/ai-failover.test.ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  openAICompatChatUrl,
  openAIResponseToGeminiShape,
} from "./ai-failover.ts";

Deno.test("openAICompatChatUrl joins base + /chat/completions", () => {
  assertEquals(
    openAICompatChatUrl("https://openrouter.ai/api/v1"),
    "https://openrouter.ai/api/v1/chat/completions",
  );
});

Deno.test("openAICompatChatUrl tolerates trailing slashes", () => {
  assertEquals(
    openAICompatChatUrl("https://api.groq.com/openai/v1/"),
    "https://api.groq.com/openai/v1/chat/completions",
  );
  assertEquals(
    openAICompatChatUrl("https://integrate.api.nvidia.com/v1///"),
    "https://integrate.api.nvidia.com/v1/chat/completions",
  );
});

Deno.test("openAIResponseToGeminiShape maps text content", () => {
  const out = openAIResponseToGeminiShape({
    choices: [{ message: { role: "assistant", content: "Hello student" } }],
  });
  assertEquals(out, {
    candidates: [{ content: { parts: [{ text: "Hello student" }] } }],
  });
});

Deno.test("openAIResponseToGeminiShape maps tool calls to functionCall parts", () => {
  const out = openAIResponseToGeminiShape({
    choices: [{
      message: {
        content: "",
        tool_calls: [{
          function: { name: "generate_quiz", arguments: "{\"count\":3}" },
        }],
      },
    }],
  });
  assertEquals(out, {
    candidates: [{
      content: {
        parts: [{ functionCall: { name: "generate_quiz", args: { count: 3 } } }],
      },
    }],
  });
});

Deno.test("openAIResponseToGeminiShape survives malformed tool arguments", () => {
  const out = openAIResponseToGeminiShape({
    choices: [{
      message: {
        content: "text",
        tool_calls: [{ function: { name: "f", arguments: "not-json" } }],
      },
    }],
  });
  assertEquals(out.candidates[0].content.parts, [
    { text: "text" },
    { functionCall: { name: "f", args: {} } },
  ]);
});

Deno.test("openAIResponseToGeminiShape handles a missing message", () => {
  assertEquals(openAIResponseToGeminiShape({ choices: [] }), {
    candidates: [{ content: { parts: [] } }],
  });
  assertEquals(openAIResponseToGeminiShape(null), {
    candidates: [{ content: { parts: [] } }],
  });
});
