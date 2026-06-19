import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  parseLiveDispatchEvidence,
  validateLiveDispatchEvidence,
  writeLiveDispatchEvidenceArchive,
} from "../src/live-verification.js";

describe("Live dispatch verification", () => {
  it("writes canonical live evidence archives for operator audit", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "acp-live-evidence-"));
    const filePath = join(tempDir, "nested", "evidence.json");
    const evidence = validEvidence();
    const verification = validateLiveDispatchEvidence(evidence);

    try {
      await expect(
        writeLiveDispatchEvidenceArchive(
          filePath,
          evidence,
          verification,
          new Date("2026-06-19T00:00:00.000Z"),
        ),
      ).resolves.toEqual({
        capturedAt: "2026-06-19T00:00:00.000Z",
        evidence,
        verification,
      });

      const archive = JSON.parse(await readFile(filePath, "utf8"));
      expect(archive).toEqual({
        capturedAt: "2026-06-19T00:00:00.000Z",
        evidence,
        verification: { ok: true, errors: [] },
      });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("parses evidence from package manager output before archiving", () => {
    const raw = ["$ tsx src/index.ts", JSON.stringify(validEvidence())].join("\n");
    expect(parseLiveDispatchEvidence(raw)).toMatchObject({
      task: { id: "task-1" },
      run: { id: "run-1" },
    });
  });
});

function validEvidence() {
  return {
    task: {
      id: "task-1",
      planeId: "plane-1",
      repo: "crs-src",
      state: "Code Review",
    },
    run: {
      id: "run-1",
      status: "succeeded",
      role: "Development Agent",
      attempt: 1,
      promptReleaseId: "prompt-release-1",
      workspacePath: "/tmp/crs-src/runs/run-1",
      conversationId: "conversation-1",
      conversationUrl: "https://openhands.test/conversations/conversation-1",
      langfuseTraceId: "trace-1",
      langfuseTraceUrl: "https://langfuse.test/trace-1",
      nextState: "Code Review",
      summary: "Implemented.",
    },
    verification: {
      runDetailPath: "/runs/run-1",
      planeEvidence: "plane-1",
      planeStateEvidence: "Code Review",
      planeCommentEvidence: "comment-1",
      openHandsEvidence: "https://openhands.test/conversations/conversation-1",
      langfuseEvidence: "https://langfuse.test/trace-1",
      expectedNextState: "Code Review",
    },
  };
}
