import { describe, expect, it, vi } from "vitest";
import { auditTaskSources, fetchTaskSourceAuditRecords } from "../src/task-source";
import type { DatabaseClient } from "../src/client";

describe("fetchTaskSourceAuditRecords", () => {
  it("queries automatic tasks for task-source cutover audit", async () => {
    const client = {
      query: vi.fn().mockResolvedValue({
        rows: [
          {
            id: "task-1",
            identifier: "TOK-1",
            title: "Build",
            state: "Development",
            url: "https://plane.local/workspace/acme/projects/token/issues/item-1",
            project_slug: "token",
            repository_id: "repo-1",
            repository_slug: "crs-src",
            latest_run_id: "run-1",
            latest_run_status: "succeeded",
            latest_run_event_count: "3",
            progress_item_count: "2",
            conversation_url: "https://openhands.local/conversation/run-1",
            trace_url: "https://langfuse.local/project/p/traces/t",
            updated_at: new Date("2026-06-19T12:00:00.000Z"),
          },
        ],
      }),
    } as unknown as DatabaseClient;

    await expect(
      fetchTaskSourceAuditRecords(client, {
        projectSlug: "token",
        limit: 10,
      }),
    ).resolves.toEqual([
      {
        taskId: "task-1",
        identifier: "TOK-1",
        title: "Build",
        state: "Development",
        url: "https://plane.local/workspace/acme/projects/token/issues/item-1",
        projectSlug: "token",
        repositoryId: "repo-1",
        repositorySlug: "crs-src",
        latestRunId: "run-1",
        latestRunStatus: "succeeded",
        latestRunEventCount: 3,
        progressItemCount: 2,
        conversationUrl: "https://openhands.local/conversation/run-1",
        traceUrl: "https://langfuse.local/project/p/traces/t",
        updatedAt: new Date("2026-06-19T12:00:00.000Z"),
      },
    ]);

    expect(client.query).toHaveBeenCalledWith(expect.stringContaining("projects.slug = $3"), [
      ["Todo", "Development", "Code Review", "In Merge", "Release Version", "Deployment"],
      10,
      "token",
    ]);
  });
});

describe("auditTaskSources", () => {
  it("passes Plane-routed tasks with default codex-cli evidence", async () => {
    const client = clientWithRows([
      row({
        url: "https://plane.local/workspace/acme/projects/token/issues/item-1",
        repository_id: "repo-1",
        latest_run_id: "run-1",
        latest_run_event_count: "4",
        progress_item_count: "2",
        conversation_url: null,
        trace_url: null,
      }),
    ]);

    await expect(
      auditTaskSources(client, {
        planeBaseUrl: "https://plane.local/",
      }),
    ).resolves.toMatchObject({
      checked: 1,
      planeUrlCount: 1,
      linearUrlCount: 0,
      routedCount: 1,
      runEvidenceCount: 1,
      runEventEvidenceCount: 1,
      progressEvidenceCount: 1,
      conversationEvidenceCount: 0,
      traceEvidenceCount: 0,
      violations: [],
    });
  });

  it("flags Linear URLs and missing repository routing", async () => {
    const client = clientWithRows([
      row({
        identifier: "TOK-2",
        url: "https://linear.app/acme/issue/TOK-2/build",
        repository_id: null,
      }),
    ]);

    const result = await auditTaskSources(client, {
      planeBaseUrl: "https://plane.local",
    });

    expect(result.linearUrlCount).toBe(1);
    expect(result.violations.map((violation) => violation.type)).toEqual([
      "linear_url",
      "non_plane_url",
      "missing_repository_routing",
    ]);
  });

  it("flags missing codex-cli run event and progress evidence by default", async () => {
    const client = clientWithRows([
      row({
        latest_run_id: "run-1",
        latest_run_event_count: "0",
        progress_item_count: "0",
        conversation_url: null,
        trace_url: null,
      }),
    ]);

    const result = await auditTaskSources(client, {
      planeBaseUrl: "https://plane.local",
    });

    expect(result.violations.map((violation) => violation.type)).toEqual([
      "missing_run_event_evidence",
      "missing_progress_evidence",
    ]);
  });

  it("requires OpenHands conversation and Langfuse trace evidence for legacy profile", async () => {
    const client = clientWithRows([
      row({
        latest_run_id: "run-1",
        latest_run_event_count: "4",
        progress_item_count: "2",
        conversation_url: null,
        trace_url: null,
      }),
    ]);

    const result = await auditTaskSources(client, {
      executionProfile: "legacy-openhands",
      planeBaseUrl: "https://plane.local",
    });

    expect(result.violations.map((violation) => violation.type)).toEqual([
      "missing_conversation_evidence",
      "missing_trace_evidence",
    ]);
  });

  it("fails when no task-source sample exists by default", async () => {
    const client = clientWithRows([]);

    const result = await auditTaskSources(client, {
      planeBaseUrl: "https://plane.local",
    });

    expect(result.checked).toBe(0);
    expect(result.violations).toEqual([
      {
        type: "missing_run_evidence",
        identifier: "task-source-smoke",
        message: "No automatic non-terminal tasks were available to audit",
      },
    ]);
  });
});

function clientWithRows(rows: unknown[]): DatabaseClient {
  return {
    query: vi.fn().mockResolvedValue({ rows }),
  } as unknown as DatabaseClient;
}

function row(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "task-1",
    identifier: "TOK-1",
    title: "Build",
    state: "Development",
    url: "https://plane.local/workspace/acme/projects/token/issues/item-1",
    project_slug: "token",
    repository_id: "repo-1",
    repository_slug: "crs-src",
    latest_run_id: "run-1",
    latest_run_status: "succeeded",
    latest_run_event_count: "3",
    progress_item_count: "1",
    conversation_url: "https://openhands.local/conversation/run-1",
    trace_url: "https://langfuse.local/project/p/traces/t",
    updated_at: new Date("2026-06-19T12:00:00.000Z"),
    ...overrides,
  };
}
