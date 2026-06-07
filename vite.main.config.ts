import { defineConfig } from "vite";
import { getBuildFeatureFlagDefines } from "./src/shared/feature-flags.js";

export default defineConfig({
  define: getBuildFeatureFlagDefines(process.env),
  build: {
    target: "node24",
    sourcemap: true,
    rollupOptions: {
      output: {
        entryFileNames: (chunkInfo) => `${chunkInfo.name}.cjs`
      }
    }
  }
});
