import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "../../src/renderer/App.js";
import {
  buildDiagnostics,
  buildProject,
  buildRunAudit,
  buildSessionPreview,
  buildSessionSummary,
  installBridgeMocks
} from "./triage-test-helpers.js";

describe("triage truth states", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("never flattens unsupported or unknown evidence into passed or clean states", async () => {
    window.location.hash = "#/sessions";
    installBridgeMocks({
      sessions: [
        buildSessionSummary({
          verificationState: { label: "Unknown", tone: "neutral", reason: "No verification evidence." },
          runAuditState: { label: "Needs Review", tone: "warning" }
        })
      ],
      firstPreview: buildSessionPreview({
        verificationState: { label: "Unknown", tone: "neutral", reason: "No verification evidence." },
        runAuditState: { label: "Needs Review", tone: "warning" }
      }),
      projects: [
        buildProject({
          latestVerification: { label: "Unknown", tone: "neutral" },
          latestRunAudit: { label: "Needs Review", tone: "warning" }
        })
      ],
      runAudit: buildRunAudit({
        sections: [
          {
            id: "git-github",
            title: "Git / GitHub",
            summary: "Phase 6 shows placeholders until read-only providers land in Phase 7.",
            items: [{ label: "Repo State", value: "Unknown", tone: "neutral" }]
          }
        ]
      }),
      diagnostics: buildDiagnostics()
    });
    render(<App />);

    expect(await screen.findByText("Unknown")).toBeInTheDocument();
    expect(screen.getAllByText("Unsupported").length).toBeGreaterThan(0);
    expect(screen.queryByText("Passed")).not.toBeInTheDocument();
    expect(screen.queryByText("Clean")).not.toBeInTheDocument();
  });
});
