# Phase 7: Git, GitHub, Export, and Import - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md - this log preserves the alternatives considered.

**Date:** 2026-05-24
**Phase:** 07-git-github-export-and-import
**Areas discussed:** Repo-root confidence gate, GitHub snapshot depth, Export package default, Imported archive behavior

---

## Repo-root confidence gate

### Q1. Which confidence levels may trigger shared git inspection?

| Option | Description | Selected |
|--------|-------------|----------|
| Git only after validated repo root | Attempt validation from confirmed or observed candidates, and publish git data only after the shared provider confirms the repo root. | ✓ |
| Allow observed and inferred roots directly | Increases coverage, but risks overstating repo truth from weak evidence. | |
| Disable git unless the adapter already provides a confirmed root | Safest, but leaves useful `.project_root` evidence underused. | |

**User's choice:** Git only after validated repo root
**Notes:** Auto-selected the recommended default to match the spec's validated-root security boundary and the roadmap's confidence gating requirement.

### Q2. Where should git snapshots live once collected?

| Option | Description | Selected |
|--------|-------------|----------|
| Project-scoped cached snapshot | One shared snapshot per normalized project, reused across Projects and Run Audit. | ✓ |
| Session-scoped snapshot | Attach repo state independently to each session. | |
| Renderer-triggered live lookup | Fetch git data on demand from individual pages. | |

**User's choice:** Project-scoped cached snapshot
**Notes:** Auto-selected the shared project snapshot so repo truth stays main-owned, cache-backed, and consistent across surfaces.

### Q3. Which git fields belong in Phase 7?

| Option | Description | Selected |
|--------|-------------|----------|
| Branch, HEAD, dirty state, counts, additions/deletions, remote URL only | Covers the roadmap contract without copying diff bodies or mutable repo data. | ✓ |
| Include diff bodies and patch previews | Richer evidence, but higher privacy and scope risk. | |
| Limit to branch and HEAD only | Smaller slice, but too weak for dirty-after-claim and audit use cases. | |

**User's choice:** Branch, HEAD, dirty state, counts, additions/deletions, remote URL only
**Notes:** Auto-selected the roadmap-complete, privacy-conscious middle path.

### Q4. How should git command failures surface?

| Option | Description | Selected |
|--------|-------------|----------|
| Unknown or unsupported fields plus diagnostics | Preserve truthful UI without failing the whole scan. | ✓ |
| Fail the whole scan | Treat repo lookup failure as a blocking error. | |
| Hide the git section silently | Avoids clutter, but would flatten missing evidence. | |

**User's choice:** Unknown or unsupported fields plus diagnostics
**Notes:** Auto-selected the option that preserves explicit truth states from Phase 6.

---

## GitHub snapshot depth

### Q1. When should the shared GitHub provider run?

| Option | Description | Selected |
|--------|-------------|----------|
| Validated git root plus remote URL plus gh available | Run only after the shared git provider has enough trustworthy repo context. | ✓ |
| Whenever gh is installed | Broader coverage, but detached from repo certainty. | |
| Only from a manual renderer action | Avoids automatic collection, but breaks the shared scan model. | |

**User's choice:** Validated git root plus remote URL plus gh available
**Notes:** Auto-selected the recommended boundary so GitHub stays optional, read-only, and rooted in validated repo context.

### Q2. How deep should the GitHub snapshot go in V1?

| Option | Description | Selected |
|--------|-------------|----------|
| PR summary plus checks and review or merge state | Covers the roadmap contract without turning the app into a PR client. | ✓ |
| PR summary only | Smaller slice, but misses required check and review context. | |
| Full timeline, comments, and reviewer detail | Richer context, but too broad for this phase. | |

**User's choice:** PR summary plus checks and review or merge state
**Notes:** Auto-selected the roadmap-complete middle option.

### Q3. When should GitHub snapshots be refreshed?

| Option | Description | Selected |
|--------|-------------|----------|
| Scan-time cached snapshot | Keep GitHub state in the same shared-core refresh path as other derived truth. | ✓ |
| Live query on every page load | Fresher, but breaks cache-backed renderer discipline. | |
| Background polling independent of scans | More automation, but broader than Phase 7 needs. | |

**User's choice:** Scan-time cached snapshot
**Notes:** Auto-selected the consistent main-owned snapshot model.

### Q4. How should GitHub failures behave?

| Option | Description | Selected |
|--------|-------------|----------|
| Unknown or unsupported GitHub context plus diagnostics | Keep sessions and projects usable while showing the gap explicitly. | ✓ |
| Mark the whole source scan failed | Overstates optional GitHub failures. | |
| Suppress GitHub fields entirely | Hides missing evidence instead of surfacing it. | |

**User's choice:** Unknown or unsupported GitHub context plus diagnostics
**Notes:** Auto-selected the option that preserves truthful capability-aware rendering.

---

## Export package default

### Q1. What should the default export include?

| Option | Description | Selected |
|--------|-------------|----------|
| Normalized data by default, raw opt-in | Safe default for reproducibility without copying sensitive transcripts automatically. | ✓ |
| Always include raw artifacts | Most complete export, but highest privacy risk. | |
| Use adapter-specific presets | Flexible, but makes exports less predictable. | |

**User's choice:** Normalized data by default, raw opt-in
**Notes:** Auto-selected the privacy-first default that still satisfies archive portability.

### Q2. Which raw artifacts may be exported?

| Option | Description | Selected |
|--------|-------------|----------|
| Only indexed and allowlisted raw artifacts | Reuses the shared safe-filesystem and raw-artifact index boundaries. | ✓ |
| Any file under the source root | Simpler, but bypasses indexed-artifact safety. | |
| Disable raw export entirely | Safest, but misses the optional raw-artifact requirement. | |

**User's choice:** Only indexed and allowlisted raw artifacts
**Notes:** Auto-selected the option that matches existing security seams and the optional raw-export requirement.

### Q3. How should privacy risk be surfaced?

| Option | Description | Selected |
|--------|-------------|----------|
| Explicit warning plus manifest flag | Warn users before copying sensitive content and preserve the choice in the archive metadata. | ✓ |
| Documentation-only warning | Lower friction, but too easy to miss. | |
| Checkbox without explanatory warning | Signals choice without enough context. | |

**User's choice:** Explicit warning plus manifest flag
**Notes:** Auto-selected the strongest truthful warning model within scope.

### Q4. What archive structure fits Phase 7 best?

| Option | Description | Selected |
|--------|-------------|----------|
| Manifest plus normalized payloads plus optional raw bundle | Harness-neutral and easy to import as read-only data later. | ✓ |
| Tarball of the full source root | Easy to implement, but too broad and privacy-heavy. | |
| Single JSON blob for everything | Simple, but awkward for optional raw files and large payloads. | |

**User's choice:** Manifest plus normalized payloads plus optional raw bundle
**Notes:** Auto-selected the structure that best fits the phase contract and future import needs.

---

## Imported archive behavior

### Q1. How should imported archives appear in the app?

| Option | Description | Selected |
|--------|-------------|----------|
| Persistent read-only data source | Reuse the existing source list, runtime, and triage patterns. | ✓ |
| Temporary in-memory preview | Lighter-weight, but disconnected from existing source management. | |
| Separate standalone archive viewer | Clearer separation, but duplicates the triage UI surface. | |

**User's choice:** Persistent read-only data source
**Notes:** Auto-selected the option that keeps imports inside the established workbench flow.

### Q2. How should imported archives be modeled in source metadata?

| Option | Description | Selected |
|--------|-------------|----------|
| Explicit imported-archive metadata | Add clear `sourceKind` and `addedBy` semantics for imported sources. | ✓ |
| Reuse generic local-root records | Minimal schema change, but blurs archive semantics. | |
| Hide archive identity inside the renderer only | Avoids source schema work, but breaks shared-core truth. | |

**User's choice:** Explicit imported-archive metadata
**Notes:** Auto-selected the option that keeps archive semantics shared-core and inspectable.

### Q3. Which operations should imported archives allow?

| Option | Description | Selected |
|--------|-------------|----------|
| Render-only with no host validate/scan/watch/git/gh | Keep imported archives safely read-only and detached from live repo assumptions. | ✓ |
| Allow rescanning the archive like a live source | Adds flexibility, but muddles imported versus live evidence. | |
| Convert imported archives into local writable sources | Drifts into control and mutation scope. | |

**User's choice:** Render-only with no host validate/scan/watch/git/gh
**Notes:** Auto-selected the safest model that still satisfies imported-session rendering.

### Q4. What implementation seam should own imported archives?

| Option | Description | Selected |
|--------|-------------|----------|
| Dedicated archive-reader adapter | Keeps imported archives inside the shared adapter registry and runtime flow. | ✓ |
| Renderer-only special case | Fastest path, but violates shared-core ownership. | |
| Reuse fake-test adapter behavior | Avoids a new adapter, but muddies fixture proof and real import behavior. | |

**User's choice:** Dedicated archive-reader adapter
**Notes:** Auto-selected the option that best preserves adapter neutrality and a future second real adapter seam.

---

## the agent's Discretion

- Autonomous run selected the recommended default for every generated question.
- Final file and module placement, DTO naming, and manifest version details remain agent discretion within the boundaries captured in CONTEXT.md.

## Deferred Ideas

- GitHub comment timelines, review conversation replay, and any PR write actions remain future work beyond Phase 7's read-only snapshot scope.
- Diff-body export, transcript redaction profiles, and deeper privacy tooling belong in a later privacy-focused slice.
- Rebinding imported archives back to live local repositories or converting them into writable sources stays out of scope for V1.
