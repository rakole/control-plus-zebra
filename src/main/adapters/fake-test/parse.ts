import { readFile } from "node:fs/promises";

import type { RawArtifactRef } from "../../core/adapter-contract/types.js";
import type { RawHarnessEvent } from "../../core/adapter-contract/index.js";
import { fakeHarnessFixtureSchema, type FakeParsedPayload } from "./types.js";

export type FakeRawEvent = RawHarnessEvent<FakeParsedPayload>;

function buildParseDiagnosticEvent(
  artifact: RawArtifactRef,
  suffix: string,
  message: string,
  nativeId?: string
): FakeRawEvent {
  return {
    id: `${artifact.id}:parse-diagnostic:${suffix}`,
    adapterId: artifact.adapterId,
    sourceId: artifact.sourceId,
    artifactId: artifact.id,
    kind: "fake.parse-diagnostic",
    payload: {
      kind: "parse-diagnostic",
      diagnostic: {
        code: `fake-test.parse.${suffix}`,
        severity: "error",
        message,
        ...(nativeId ? { nativeId } : {})
      }
    }
  };
}

export async function* parseFakeTestArtifact(
  artifact: RawArtifactRef
): AsyncIterable<FakeRawEvent> {
  let fixtureText: string;

  try {
    fixtureText = await readFile(artifact.path, "utf8");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown read error";
    yield buildParseDiagnosticEvent(
      artifact,
      "read",
      `Unable to read fake fixture artifact: ${message}`,
      artifact.nativeId
    );
    return;
  }

  let parsedFixture: unknown;

  try {
    parsedFixture = JSON.parse(fixtureText);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid JSON";
    yield buildParseDiagnosticEvent(
      artifact,
      "json",
      `Fake fixture JSON parsing failed: ${message}`,
      artifact.nativeId
    );
    return;
  }

  const fixtureResult = fakeHarnessFixtureSchema.safeParse(parsedFixture);

  if (!fixtureResult.success) {
    const issues = fixtureResult.error.issues
      .map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`)
      .join("; ");

    yield buildParseDiagnosticEvent(
      artifact,
      "schema",
      `Fake fixture schema validation failed: ${issues}`,
      artifact.nativeId
    );
    return;
  }

  const fixture = fixtureResult.data;

  yield {
    id: `${artifact.id}:metadata`,
    adapterId: artifact.adapterId,
    sourceId: artifact.sourceId,
    artifactId: artifact.id,
    kind: "fake.fixture-metadata",
    payload: {
      kind: "fixture-metadata",
      fixture
    }
  };

  for (const event of fixture.events) {
    yield {
      id: `${artifact.id}:${event.id}`,
      adapterId: artifact.adapterId,
      sourceId: artifact.sourceId,
      artifactId: artifact.id,
      kind: `fake.${event.kind}`,
      timestamp: event.timestamp,
      payload: {
        kind: "timeline-event",
        event
      }
    };
  }
}
