export function isExplicitlyEnabled(value: string | undefined): boolean {
  return /^(1|true)$/i.test(value ?? "");
}

type BuildFlagGlobal = typeof globalThis & {
  __AW_FEATURE_GITHUB_UI__?: boolean;
};

export function getBuildFeatureFlagDefines(env: {
  AW_FEATURE_GITHUB_UI?: string;
}): Record<string, string> {
  return {
    __AW_FEATURE_GITHUB_UI__: JSON.stringify(
      isExplicitlyEnabled(env.AW_FEATURE_GITHUB_UI)
    )
  };
}

export function isGithubUiEnabled(): boolean {
  return typeof __AW_FEATURE_GITHUB_UI__ !== "undefined"
    ? __AW_FEATURE_GITHUB_UI__
    : ((globalThis as BuildFlagGlobal).__AW_FEATURE_GITHUB_UI__ ?? false);
}
