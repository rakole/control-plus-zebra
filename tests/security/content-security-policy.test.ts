import { describe, expect, it } from "vitest";

import { buildContentSecurityPolicy } from "../../src/main/security/content-security-policy.js";

const unsafeEvalToken = ["unsafe", "eval"].join("-");

describe("content security policy", () => {
  it("builds a production local-only policy", () => {
    const policy = buildContentSecurityPolicy({ mode: "production" });

    expect(policy).toContain("default-src 'self'");
    expect(policy).toContain("script-src 'self'");
    expect(policy).toContain("style-src 'self' 'unsafe-inline'");
    expect(policy).toContain("img-src 'self' data:");
    expect(policy).toContain("font-src 'self'");
    expect(policy).toContain("connect-src 'self'");
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("base-uri 'none'");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).not.toContain("https:");
    expect(policy).not.toContain("http:");
    expect(policy).not.toContain(unsafeEvalToken);
  });

  it("adds only the local Vite dev origin to development connect-src", () => {
    const policy = buildContentSecurityPolicy({
      mode: "development",
      devServerUrl: "http://localhost:5173/"
    });

    expect(policy).toContain("connect-src 'self' http://localhost:5173");
    expect(policy).toContain("script-src 'self'");
    expect(policy).not.toContain("https:");
    expect(policy).not.toContain(unsafeEvalToken);
  });

  it("rejects non-local development renderer origins", () => {
    expect(() =>
      buildContentSecurityPolicy({
        mode: "development",
        devServerUrl: "http://example.com:5173/"
      })
    ).toThrow("localhost");
  });

  it("rejects wildcard-style remote development renderer protocols", () => {
    expect(() =>
      buildContentSecurityPolicy({
        mode: "development",
        devServerUrl: `${"https:"}//localhost:5173/`
      })
    ).toThrow("local http origin");
  });
});
