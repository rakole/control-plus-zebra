import { defineConfig } from "vite";

export default defineConfig({
  build: {
    target: "node24",
    sourcemap: true,
    rollupOptions: {
      output: {
        entryFileNames: (chunkInfo) =>
          chunkInfo.name === "electron-main" ? "electron-main.cjs" : `${chunkInfo.name}.js`
      }
    }
  }
});
