export function extractExitCodeFromText(text: string): number | undefined {
  const patterns = [
    /exit code[:=\s]+(-?\d+)/iu,
    /exited with code\s+(-?\d+)/iu,
    /exit status[:=\s]+(-?\d+)/iu,
    /command failed with code\s+(-?\d+)/iu
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);

    if (match?.[1]) {
      return Number.parseInt(match[1], 10);
    }
  }

  return undefined;
}
