import { defineConfig } from "vite";

export default defineConfig({
  build: {
    target: "node24",
    sourcemap: true,
    lib: {
      entry: "src/main/electron-main.ts",
      formats: ["cjs"],
      fileName: () => "electron-main.cjs"
    }
  }
});
