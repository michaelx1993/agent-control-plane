import { describe, expect, it, vi } from "vitest";
import { findLatestConversationRefForTask, upsertConversationRef } from "../src/conversations";
import type { DatabaseClient } from "../src/client";

describe("upsertConversationRef", () => {
  it("upserts an OpenHands conversation reference for a run", async () => {
    const createdAt = new Date("2026-06-19T10:00:00Z");
    const updatedAt = new Date("2026-06-19T10:05:00Z");
    const client = {
      query: vi.fn().mockResolvedValue({
        rows: [
          {
            id: "conversation-ref-1",
            run_id: "run-1",
            provider: "mock-openhands",
            conversation_id: "mock-run-1",
            event_log_uri: "memory://events",
            event_cursor: "completed",
            ui_url: "http://localhost/mock",
            created_at: createdAt,
            updated_at: updatedAt,
          },
        ],
      }),
    } as unknown as DatabaseClient;

    await expect(
      upsertConversationRef(client, {
        runId: "run-1",
        provider: "mock-openhands",
        conversationId: "mock-run-1",
        eventLogUri: "memory://events",
        eventCursor: "completed",
        uiUrl: "http://localhost/mock",
      }),
    ).resolves.toEqual({
      id: "conversation-ref-1",
      runId: "run-1",
      provider: "mock-openhands",
      conversationId: "mock-run-1",
      eventLogUri: "memory://events",
      eventCursor: "completed",
      uiUrl: "http://localhost/mock",
      createdAt,
      updatedAt,
    });

    expect(client.query).toHaveBeenCalledWith(expect.stringContaining("conversation_refs"), [
      "run-1",
      "mock-openhands",
      "mock-run-1",
      "memory://events",
      "completed",
      "http://localhost/mock",
    ]);
  });
});

describe("findLatestConversationRefForTask", () => {
  it("returns the latest same-provider conversation reference before the current run", async () => {
    const createdAt = new Date("2026-06-20T10:00:00Z");
    const updatedAt = new Date("2026-06-20T10:05:00Z");
    const client = {
      query: vi.fn().mockResolvedValue({
        rows: [
          {
            id: "conversation-ref-2",
            run_id: "run-previous",
            provider: "codex-app-server",
            conversation_id: "thread-123/turns/turn-456",
            event_log_uri: "process://codex-app-server/threads/thread-123/turns/turn-456",
            event_cursor: "completed",
            ui_url: null,
            created_at: createdAt,
            updated_at: updatedAt,
          },
        ],
      }),
    } as unknown as DatabaseClient;

    await expect(
      findLatestConversationRefForTask(client, {
        taskId: "task-1",
        beforeRunId: "run-current",
        provider: "codex-app-server",
      }),
    ).resolves.toEqual({
      id: "conversation-ref-2",
      runId: "run-previous",
      provider: "codex-app-server",
      conversationId: "thread-123/turns/turn-456",
      eventLogUri: "process://codex-app-server/threads/thread-123/turns/turn-456",
      eventCursor: "completed",
      createdAt,
      updatedAt,
    });

    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("join runs on runs.id = conversation_refs.run_id"),
      ["task-1", "run-current", "codex-app-server"],
    );
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("order by conversation_refs.updated_at desc"),
      expect.any(Array),
    );
  });
});
