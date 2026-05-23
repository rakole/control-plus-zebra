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
    files: ["src/main/core/**/*.ts", "src/renderer/**/*.ts", "src/renderer/**/*.tsx"],
    languageOptions: {
      parser: tseslint.parser
    },
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "Identifier[name=/Gemini/]",
          message:
            "Shared core and renderer must stay harness-neutral; move Gemini-specific symbols into adapter-private code."
        },
        {
          selector:
            "BinaryExpression[operator='==='] > Literal[value='gemini-cli'], BinaryExpression[operator='!=='] > Literal[value='gemini-cli'], BinaryExpression[operator='=='] > Literal[value='gemini-cli'], BinaryExpression[operator='!='] > Literal[value='gemini-cli'], SwitchCase > Literal[value='gemini-cli']",
          message:
            "Shared core and renderer must not branch on Gemini provider IDs; use adapter metadata and capabilities instead."
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
              group: ["../main/**", "../../main/**", "**/main/**"],
              message:
                "Renderer code must not import main-process internals; consume preload bridge view models instead."
            },
            {
              group: ["**/adapters/**"],
              message:
                "Renderer code must not import adapter-private modules; consume IPC view models instead."
            }
          ],
          paths: [
            {
              name: "electron",
              message: "Renderer code must not import Electron APIs directly."
            },
            {
              name: "fs",
              message: "Renderer code must not import filesystem APIs."
            },
            {
              name: "node:fs",
              message: "Renderer code must not import filesystem APIs."
            },
            {
              name: "child_process",
              message: "Renderer code must not import shell execution APIs."
            },
            {
              name: "node:child_process",
              message: "Renderer code must not import shell execution APIs."
            }
          ]
        }
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector: "Identifier[name=/Gemini/]",
          message:
            "Shared core and renderer must stay harness-neutral; move Gemini-specific symbols into adapter-private code."
        },
        {
          selector:
            "BinaryExpression[operator='==='] > Literal[value='gemini-cli'], BinaryExpression[operator='!=='] > Literal[value='gemini-cli'], BinaryExpression[operator='=='] > Literal[value='gemini-cli'], BinaryExpression[operator='!='] > Literal[value='gemini-cli'], SwitchCase > Literal[value='gemini-cli']",
          message:
            "Shared core and renderer must not branch on Gemini provider IDs; use adapter metadata and capabilities instead."
        },
        {
          selector: "Identifier[name='ipcRenderer']",
          message: "Renderer code must use the typed preload bridge, not ipcRenderer."
        },
        {
          selector: "CallExpression[callee.name='require']",
          message: "Renderer code must not use CommonJS require."
        },
        {
          selector:
            "CallExpression[callee.object.name='window'][callee.property.name='require']",
          message: "Renderer code must not use window.require."
        },
        {
          selector: "MemberExpression[object.name='process'][property.name='env']",
          message: "Renderer code must not read process.env."
        },
        {
          selector:
            "CallExpression[callee.object.name='process'][callee.property.name='cwd']",
          message: "Renderer code must not read process.cwd."
        },
        {
          selector: "CallExpression[callee.name='eval']",
          message: "Renderer code must not evaluate strings as code."
        },
        {
          selector: "NewExpression[callee.name='Function']",
          message: "Renderer code must not construct functions from strings."
        }
      ]
    }
  },
  {
    files: ["src/main/core/adapter-contract/**/*.ts"],
    languageOptions: {
      parser: tseslint.parser
    },
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "TSPropertySignature[key.name=/^(verification(?:Status|State|Result)?|runAudit(?:Status|Classification)?|attentionReason(?:s)?)$/], PropertyDefinition[key.name=/^(verification(?:Status|State|Result)?|runAudit(?:Status|Classification)?|attentionReason(?:s)?)$/], Property[key.name=/^(verification(?:Status|State|Result)?|runAudit(?:Status|Classification)?|attentionReason(?:s)?)$/]",
          message:
            "Adapter-facing shared contracts must emit evidence and diagnostics only, not final verification or run-audit conclusions."
        }
      ]
    }
  }
);
