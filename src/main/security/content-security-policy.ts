export type ContentSecurityPolicyMode = "development" | "production";

export interface BuildContentSecurityPolicyOptions {
  mode: ContentSecurityPolicyMode;
  devServerUrl?: string | undefined;
}

const LOCAL_DEV_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

export function buildContentSecurityPolicy({
  mode,
  devServerUrl
}: BuildContentSecurityPolicyOptions): string {
  const connectSources = ["'self'"];

  if (mode === "development" && devServerUrl) {
    connectSources.push(getLocalDevOrigin(devServerUrl));
  }

  const directives = [
    ["default-src", "'self'"],
    ["script-src", "'self'"],
    ["style-src", "'self'", "'unsafe-inline'"],
    ["img-src", "'self'", "data:"],
    ["font-src", "'self'"],
    ["connect-src", ...connectSources],
    ["object-src", "'none'"],
    ["base-uri", "'none'"],
    ["frame-ancestors", "'none'"]
  ];

  return directives.map((directive) => directive.join(" ")).join("; ");
}

function getLocalDevOrigin(devServerUrl: string): string {
  const parsed = new URL(devServerUrl);

  if (parsed.protocol !== "http:") {
    throw new Error("Renderer development server must use a local http origin.");
  }

  if (!LOCAL_DEV_HOSTS.has(parsed.hostname)) {
    throw new Error("Renderer development server must be hosted on localhost.");
  }

  if (!parsed.port) {
    throw new Error("Renderer development server must include an explicit port.");
  }

  return parsed.origin;
}
