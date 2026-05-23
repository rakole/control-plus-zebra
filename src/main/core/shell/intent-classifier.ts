import type { ShellCommandIntent } from "./types.js";

export function classifyShellIntent(command: string): ShellCommandIntent {
  const normalizedCommand = command.trim().toLowerCase();

  if (normalizedCommand.length === 0) {
    return "unknown";
  }

  if (
    /\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?test\b/u.test(normalizedCommand) ||
    /\b(?:vitest|jest|ava|mocha|pytest|phpunit|rspec)\b/u.test(normalizedCommand) ||
    /\b(?:go|cargo)\s+test\b/u.test(normalizedCommand)
  ) {
    return "test";
  }

  if (
    /\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?build\b/u.test(normalizedCommand) ||
    /\b(?:vite|webpack|rollup|next|nuxt)\s+build\b/u.test(normalizedCommand)
  ) {
    return "build";
  }

  if (
    /\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?typecheck\b/u.test(normalizedCommand) ||
    /\btsc\b/u.test(normalizedCommand) ||
    /\b(?:pyright|mypy)\b/u.test(normalizedCommand)
  ) {
    return "typecheck";
  }

  if (
    /\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?lint\b/u.test(normalizedCommand) ||
    /\b(?:eslint|stylelint|ruff)\b/u.test(normalizedCommand)
  ) {
    return "lint";
  }

  if (
    /\b(?:npm|pnpm|yarn|bun|pip|pip3)\s+install\b/u.test(normalizedCommand) ||
    /\b(?:cargo|go)\s+install\b/u.test(normalizedCommand)
  ) {
    return "install";
  }

  if (/\bgit\b/u.test(normalizedCommand)) {
    return "git";
  }

  return "other";
}
