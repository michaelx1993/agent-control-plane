import { describe, expect, it } from "vitest";
import { HttpOpenHandsAdapter, MockOpenHandsAdapter } from "../src/index.js";

describe("MockOpenHandsAdapter", () => {
  it("creates conversations, streams events, and stores results", async () => {
    const adapter = new MockOpenHandsAdapter("https://openhands.example");

    const conversation = await adapter.createConversation({
      taskId: "task-1",
      runId: "run-1",
      repo: "crs-src",
      prompt: "Fix the task",
    });
    await adapter.startRun(conversation.id);
    adapter.appendToolCall(conversation.id, "shell", { cmd: "pnpm test" });
    const result = adapter.completeRun(conversation.id, { summary: "Done" });

    const firstPage = await adapter.listEvents(conversation.id);
    const secondPage = await adapter.listEvents(conversation.id, firstPage.nextCursor);

    expect(conversation.url).toBe("https://openhands.example/conversations/mock-conversation-1");
    expect(firstPage.events.map((event) => event.type)).toEqual([
      "run.status",
      "agent.message",
      "run.status",
      "tool.call",
      "run.status",
    ]);
    expect(secondPage.events).toEqual([]);
    await expect(adapter.getResult(conversation.id)).resolves.toEqual(result);
  });
});

describe("HttpOpenHandsAdapter", () => {
  it("sends configurable HTTP payloads and parses event cursors/results", async () => {
    const requests: Array<{ input: string; init?: { method?: string; body?: string } }> = [];
    const fetch = async (input: string, init?: { method?: string; body?: string }) => {
      requests.push({ input, init });

      if (input === "https://openhands.example/api/conversations") {
        return jsonResponse({
          conversation: {
            id: "conversation-1",
            url: "https://openhands.example/conversations/conversation-1",
          },
        });
      }

      if (input === "https://openhands.example/api/runs") {
        return jsonResponse({ ok: true });
      }

      if (
        input === "https://openhands.example/api/conversations/conversation-1/events?cursor=abc"
      ) {
        return jsonResponse({
          events: [
            {
              id: "event-1",
              conversationId: "conversation-1",
              type: "run.status",
              status: "completed",
              createdAt: "2026-01-01T00:00:00.000Z",
            },
          ],
          nextCursor: "def",
        });
      }

      if (input === "https://openhands.example/api/runs/conversation-1/result") {
        return jsonResponse({
          result: {
            conversationId: "conversation-1",
            status: "completed",
            summary: "fixed",
            eventCursor: "def",
            artifacts: [{ kind: "patch", path: "fix.diff" }],
          },
        });
      }

      throw new Error(`Unexpected request: ${input}`);
    };
    const adapter = new HttpOpenHandsAdapter({
      baseUrl: "https://openhands.example/",
      fetch,
    });

    const conversation = await adapter.createConversation({
      taskId: "task-1",
      runId: "run-1",
      repo: "repo-1",
      workspacePath: "/workspace/repo-1",
      prompt: "Fix the task",
      metadata: { role: "Development" },
    });
    await adapter.startRun(conversation.id);
    const page = await adapter.listEvents(conversation.id, "abc");
    const result = await adapter.getResult(conversation.id);

    expect(conversation).toEqual({
      id: "conversation-1",
      url: "https://openhands.example/conversations/conversation-1",
      workspacePath: "/workspace/repo-1",
      repo: "repo-1",
      taskId: "task-1",
      runId: "run-1",
    });
    expect(JSON.parse(requests[0].init?.body ?? "{}")).toMatchObject({
      taskId: "task-1",
      runId: "run-1",
      repo: "repo-1",
      prompt: "Fix the task",
    });
    expect(JSON.parse(requests[1].init?.body ?? "{}")).toEqual({
      conversationId: "conversation-1",
    });
    expect(page.nextCursor).toBe("def");
    expect(page.events[0]).toMatchObject({ type: "run.status", status: "completed" });
    expect(result).toMatchObject({
      conversationId: "conversation-1",
      status: "completed",
      summary: "fixed",
      eventCursor: "def",
    });
  });
});

function jsonResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  };
}
