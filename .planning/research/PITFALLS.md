# Pitfalls Research

**Domain:** Local-first coding-agent session observability and audit
**Researched:** 2026-05-23
**Confidence:** HIGH for adapter/security/audit pitfalls, MEDIUM for performance thresholds until real fixture volumes are measured

## Critical Pitfalls

### Pitfall 1: The First-Adapter Trap

**What goes wrong:**
Shared types, IPC names, cache keys, tests, and UI pages become Gemini-specific. Adding another harness requires editing Gemini code or duplicating core systems.

**Why it happens:**
Gemini is the first real fixture source, so its file layout feels like the architecture.

**How to avoid:**
Build the adapter contract, fake adapter, normalized model, capabilities, diagnostics, and import-boundary tests before UI implementation. Ban shared `Gemini*` types and `gemini:*` IPC names.

**Warning signs:**
Core imports `src/main/adapters/gemini-cli/*`; renderer checks `adapterId === "gemini-cli"` for behavior; cache keys omit `adapterId`.

**Phase to address:**
Phase 0/1.

---

### Pitfall 2: Tool Success Treated as Verification Success

**What goes wrong:**
A shell tool reports success because the tool invocation completed, while the command output contains a failing exit code or failing tests. The app marks the run clean.

**Why it happens:**
Raw harness status fields are tempting shortcuts.

**How to avoid:**
Adapters emit `ShellCommandEvidence`; shared shell parser extracts exit code, intent, failure state, and test summaries. Verification engine owns final classification.

**Warning signs:**
Adapter code assigns `verification.state = "passed"`; run audit reads raw tool status directly; tests do not include shell-failure fixtures.

**Phase to address:**
Shell/verification/audit phase.

---

### Pitfall 3: Missing Evidence Rendered as Zero

**What goes wrong:**
A harness that cannot report shell output displays "0 failed commands" or "0 mutations," making unknown sessions look safe.

**Why it happens:**
Dashboard metrics prefer numbers, but capability gaps are semantically different from zero.

**How to avoid:**
Capabilities are mandatory at adapter/source/session levels. UI renders unsupported/unknown states and coverage warnings.

**Warning signs:**
Dashboard aggregation uses `count || 0`; no capability warnings appear in Sessions or Run Audit; unsupported harnesses can be classified clean.

**Phase to address:**
Core model/capabilities and UI phases.

---

### Pitfall 4: Unsafe Electron Boundary

**What goes wrong:**
Renderer gains raw filesystem, shell, or Electron APIs. A UI bug or injected content can access local transcripts, repos, or commands.

**Why it happens:**
Exposing `ipcRenderer`, broad preload APIs, or Node integration is faster during prototyping.

**How to avoid:**
Keep `nodeIntegration` off, `contextIsolation` on, sandboxing on, restrictive CSP, no remote code, and one typed preload method per allowed IPC operation. Validate sender and payloads.

**Warning signs:**
`contextBridge.exposeInMainWorld` exposes `ipcRenderer`; renderer imports `fs`; CSP is missing; arbitrary path read IPC exists.

**Phase to address:**
Electron scaffold/app shell phase.

---

### Pitfall 5: Parser Fragility on Active or Corrupt Artifacts

**What goes wrong:**
Active JSONL files, duplicate records, partial sidecars, or corrupt rows crash scanning or silently drop evidence.

**Why it happens:**
Fixture sets only cover happy-path completed sessions.

**How to avoid:**
Adapters must tolerate partial data, emit diagnostics, preserve raw pointers, and include fixtures for active, duplicate, corrupt, cancellation, and missing-sidecar scenarios.

**Warning signs:**
Parser throws on first bad row; diagnostics are not visible in UI; golden tests only cover basic sessions.

**Phase to address:**
Gemini adapter and contract-test phases.

---

### Pitfall 6: Cache and ID Collisions Across Harnesses

**What goes wrong:**
Two harnesses use the same native session ID or artifact path pattern; cache entries overwrite each other or sessions merge incorrectly.

**Why it happens:**
IDs are generated from native IDs without adapter/source context.

**How to avoid:**
Global IDs and cache keys include `adapterId`, `sourceId`, raw artifact identity, adapter version, and schema version.

**Warning signs:**
Session ID helpers accept only `nativeSessionId`; cache key code lacks adapter/source arguments.

**Phase to address:**
Core model/cache phase.

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Hardcoding Gemini labels in UI | Faster demo | Future adapters require UI edits | Only display labels from adapter descriptor metadata |
| Skipping fake adapter | Faster Gemini parser | Neutrality unproven until too late | Never for Phase 0/1 |
| Parsing raw logs directly into UI objects | Fewer layers | No reusable audit engine | Never |
| Starting with SQLite native dependency | Powerful queries | Packaging and rebuild risk | After file-backed cache proves insufficient |
| Ignoring diagnostics | Cleaner UI | Hidden parser failures and false trust | Never |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Electron IPC | Expose broad IPC or `ipcRenderer` | Narrow typed preload facade, schema validation, sender checks |
| Gemini sidecars | Assume all sidecars are JSON or always present | Detect JSON wrapper vs plain text, missing files, size limits, diagnostics |
| git | Run git from arbitrary paths | Only fixed read-only commands under validated/observed project roots |
| gh | Treat gh absence as failure | Optional provider; unavailable means no GitHub context |
| Watcher | Let adapters create watchers | Adapter returns watch plan; shared orchestrator owns lifecycle |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Reparse everything on each change | Slow scans, UI stalls | Raw artifact index, mtime/size/inode checks, incremental parsing where supported | Hundreds of large sessions |
| Load full sidecar output into dashboards | Memory spikes, sluggish pages | Previews, lazy loading, size limits | Large shell outputs or generated logs |
| Render full timeline at once | Session detail freezes | Windowed/paginated timeline API | Long agent sessions with many events |
| Global search over JSON files | Slow filtering | Storage abstraction, later SQLite/FTS if needed | Thousands of sessions |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Renderer filesystem access | Transcript/repo data exposure | Main-process safe helpers only |
| Arbitrary shell execution | Command injection and data loss | Fixed read-only git/gh command runner only |
| Remote code in renderer | RCE risk amplified by Electron | Local packaged content, strict CSP, no Node integration |
| Path traversal in artifact loading | Reads outside configured roots | Allowlist paths and indexed artifact refs |
| Raw export without warning | Sensitive transcript leakage | Explicit privacy warning and opt-in raw artifact export |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Too many badges without explanation | Users cannot tell what matters | Attention reasons with short explanations and drill-down evidence |
| Hiding unknown states | False confidence | Explicit unsupported/unknown labels and capability coverage warnings |
| Timeline only as raw JSON | Hard to audit quickly | Human-readable timeline with raw pointers available for debugging |
| Project rows per harness only | Same repo appears fragmented | Default one project row per repo with harness badges; allow harness filter |
| Diagnostics buried in logs | Parser problems go unnoticed | Dedicated Diagnostics page plus per-session warnings |

## "Looks Done But Isn't" Checklist

- [ ] **Adapter contract:** Fake adapter and Gemini adapter both pass the same contract suite.
- [ ] **Boundary rules:** Tests fail if core or renderer imports adapter-private files.
- [ ] **Verification:** A fixture with `tool.status = success` and shell `Exit Code: 1` is classified failed.
- [ ] **Capabilities:** A harness without shell support renders unknown/unsupported, not clean.
- [ ] **Security:** Renderer cannot read arbitrary files or call arbitrary commands.
- [ ] **Diagnostics:** Corrupt/partial raw artifacts produce visible diagnostics instead of crashes.
- [ ] **Cache:** IDs and keys include `adapterId` and `sourceId`.
- [ ] **UI:** No behavior branch like `if adapterId === "gemini-cli"` outside metadata/capability display.

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| First-adapter core | HIGH | Stop feature work, introduce adapter contract, rename shared types, add fake adapter, add boundary tests |
| Unsafe IPC | HIGH | Remove broad APIs, add preload facade, validate IPC payloads, audit renderer imports |
| Missing-evidence-as-zero | MEDIUM | Add capability model, update view models, add unknown/unsupported states |
| Parser fragility | MEDIUM | Add corrupt/partial fixtures, convert throws to diagnostics, add golden tests |
| Cache collisions | MEDIUM | Migrate IDs/cache keys, rebuild cache, add collision tests |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| First-adapter trap | Phase 0/1 | Fake adapter renders through same flow; no shared `Gemini*` types |
| Tool status shortcut | Shared shell/audit phase | Shell-failure fixture classified verification-failed |
| Unsupported as zero | Core model/UI phase | Unsupported fixture renders unknown and cannot be clean |
| Unsafe Electron boundary | App shell phase | Renderer import scan and IPC tests pass |
| Parser fragility | Gemini adapter phase | Corrupt/partial/duplicate/cancelled fixtures pass with diagnostics |
| Cache collision | Ingestion/cache phase | Same native ID across fake and Gemini creates distinct sessions |

## Sources

- `.spec/spec-from-5.5-revision-1.md` - parser truth rules, adapter boundary, and revised phase list.
- `.spec/additional-instructions.md` - architecture guardrails and V1 exclusions.
- https://www.electronjs.org/docs/latest/tutorial/security - Electron security checklist and local code risks.
- https://www.electronjs.org/docs/latest/tutorial/context-isolation - contextBridge safety guidance.
- https://www.electronjs.org/docs/latest/tutorial/ipc - IPC patterns.
- https://releases.electronjs.org/release/v42.2.0 - current Electron release and security-relevant update posture.

---
*Pitfalls research for: Agent Workbench*
*Researched: 2026-05-23*
