export function formatArchiveScopeSummary(
  scopeLabel: string,
  sessionCount: number,
  sourceCount: number
): string {
  return `${scopeLabel} · ${sessionCount} session${sessionCount === 1 ? "" : "s"} across ${sourceCount} source${sourceCount === 1 ? "" : "s"}.`;
}
