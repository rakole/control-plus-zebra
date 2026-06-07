import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { getBuildFeatureFlagDefines } from "./src/shared/feature-flags.js";

export default defineConfig({
  root: "src/renderer",
  base: "./",
  define: getBuildFeatureFlagDefines(process.env),
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src/renderer", import.meta.url))
    }
  },
  plugins: [react(), tailwindcss()],
  build: {
    target: "chrome148"
  }
});
