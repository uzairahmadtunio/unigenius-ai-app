import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react-swc";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "text"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/test/**",
        "src/**/*.test.{ts,tsx}",
        "src/**/*.spec.{ts,tsx}",
        "src/main.tsx",
        "src/vite-env.d.ts",
        "src/integrations/supabase/types.ts",
      ],
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // Production (Vite) honours mammoth's "browser" field and loads the
      // browser build, whose unzip accepts { arrayBuffer }. Vitest resolves
      // the Node build, which rejects arrayBuffer — alias to the browser
      // bundle so tests exercise the same code path as production.
      mammoth: path.resolve(__dirname, "./node_modules/mammoth/mammoth.browser.js"),
    },
  },
});
