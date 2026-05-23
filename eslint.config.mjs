import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "node_modules/**",
      "tests/boundaries/fixtures/**"
    ]
  },
  {
    files: ["**/*.{js,mjs}"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module"
    }
  },
  {
    files: ["src/main/core/**/*.ts"],
    ignores: ["src/main/core/registry/register-bundled-adapters.ts"],
    languageOptions: {
      parser: tseslint.parser
    },
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/adapters/**"],
              message:
                "Shared core must not import adapter modules directly outside the bundled-adapter registry entrypoint."
            }
          ]
        }
      ]
    }
  },
  {
    files: ["src/renderer/**/*.ts", "src/renderer/**/*.tsx"],
    languageOptions: {
      parser: tseslint.parser
    },
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/adapters/**"],
              message:
                "Renderer code must not import adapter-private modules; consume IPC view models instead."
            }
          ]
        }
      ]
    }
  }
);
