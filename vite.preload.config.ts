import { defineConfig } from "vite";

export default defineConfig({
  build: {
    target: "chrome148",
    sourcemap: true,
    rollupOptions: {
      output: {
        entryFileNames: "preload.js"
      }
    }
  }
});
