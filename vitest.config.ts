import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "node",
          environment: "node",
          include: ["tests/**/*.test.ts"],
          exclude: ["tests/renderer/**/*.test.tsx"]
        }
      },
      {
        test: {
          name: "renderer",
          environment: "jsdom",
          include: ["tests/renderer/**/*.test.tsx"],
          setupFiles: ["src/renderer/test/setup.ts"]
        }
      }
    ]
  }
});
