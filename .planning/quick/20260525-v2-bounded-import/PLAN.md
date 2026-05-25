---
quick_id: 20260525-v2-bounded-import
slug: v2-bounded-import
status: in-progress
created_at: "2026-05-25T00:00:00Z"
---

# V2-Only Bounded Import Architecture

Implement the user-approved v2-only bounded import/export architecture for oversized logs and archives.

## Scope

- Replace monolithic archive v1 production paths with v2 sectioned NDJSON archive import/export.
- Add bounded-ingestion limits and diagnostics/errors for oversized sections, lines, batches, and raw artifacts.
- Add bounded filesystem stream helpers and convert Gemini JSONL parsing away from whole-file row splitting.
- Add paged session list and timeline IPC contracts and renderer loading.
- Keep renderer DTO-only and preserve read-only/truth-state guarantees.

## Verification

- Focused archive importer/exporter tests.
- Gemini parse large JSONL tests.
- IPC/session detail pagination tests.
- Typecheck and relevant node/renderer tests.
