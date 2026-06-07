interface GitHubDiagnosticLike {
  code: string;
  message: string;
}

export interface GitRemoteRepoRef {
  fullName: string;
  host: string;
}

export function parseGitRemoteRepoRef(
  remoteUrl: string,
): GitRemoteRepoRef | undefined {
  const sshMatch = remoteUrl.match(/^git@([^:]+):([^/]+)\/(.+?)(?:\.git)?$/u);

  if (sshMatch) {
    return {
      host: sshMatch[1] ?? "github.com",
      fullName: `${sshMatch[2]}/${sshMatch[3]}`,
    };
  }

  const httpsMatch = remoteUrl.match(
    /^(?:https?|ssh):\/\/(?:git@)?([^/]+)\/([^/]+)\/(.+?)(?:\.git)?$/u,
  );

  if (httpsMatch) {
    return {
      host: httpsMatch[1] ?? "github.com",
      fullName: `${httpsMatch[2]}/${httpsMatch[3]}`,
    };
  }

  return undefined;
}

export function isGitHubOnlyMessage(message: string): boolean {
  return /github context|shared read-only `gh`/i.test(message);
}

export function isGitHubOnlyDiagnostic(
  diagnostic: GitHubDiagnosticLike,
): boolean {
  return (
    diagnostic.code.startsWith("github.") ||
    isGitHubOnlyMessage(diagnostic.message)
  );
}

export function isGitHubHostedRemoteUrl(remoteUrl: string): boolean {
  const repoRef = parseGitRemoteRepoRef(remoteUrl);

  if (!repoRef) {
    return false;
  }

  const normalizedHost = repoRef.host.trim().toLowerCase();

  if (normalizedHost === "github.com") {
    return true;
  }

  return normalizedHost
    .split(".")
    .some((label) => label.split("-").includes("github"));
}
