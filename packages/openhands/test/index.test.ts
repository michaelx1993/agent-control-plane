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
  it("uses the current OpenHands V1 app-conversations API by default", async () => {
    const requests: Array<{ input: string; init?: { method?: string; body?: string } }> = [];
    const fetch = async (input: string, init?: { method?: string; body?: string }) => {
      requests.push({ input, init });

      if (input === "https://openhands.example/api/v1/app-conversations") {
        return jsonResponse({
          id: "start-task-1",
          status: "READY",
          app_conversation_id: "conversation-1",
        });
      }

      if (
        input ===
        "https://openhands.example/api/v1/conversation/conversation-1/events/search?limit=100&page_id=abc&cursor=abc"
      ) {
        return jsonResponse({
          items: [
            {
              id: "event-1",
              conversation_id: "conversation-1",
              type: "run.status",
              status: "completed",
              timestamp: "2026-01-01T00:00:00.000Z",
            },
          ],
          next_page_id: "def",
        });
      }

      if (input === "https://openhands.example/api/v1/app-conversations?ids=conversation-1") {
        return jsonResponse([
          {
            id: "conversation-1",
            sandbox_status: "RUNNING",
            execution_status: "finished",
            title: "Fix README",
          },
        ]);
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
    expect(JSON.parse(requests[0].init?.body ?? "{}")).toEqual({
      initial_message: {
        content: [{ type: "text", text: "Fix the task" }],
      },
      selected_repository: "repo-1",
      metadata: { role: "Development" },
    });
    expect(page.nextCursor).toBe("def");
    expect(page.events[0]).toMatchObject({ type: "run.status", status: "completed" });
    expect(result).toMatchObject({
      conversationId: "conversation-1",
      status: "completed",
      summary: "Fix README",
    });
  });

  it("polls V1 start tasks until a conversation is ready", async () => {
    const requests: string[] = [];
    const fetch = async (input: string) => {
      requests.push(input);

      if (input === "https://openhands.example/api/v1/app-conversations") {
        return jsonResponse({ id: "start-task-2", status: "WORKING" });
      }

      if (
        input === "https://openhands.example/api/v1/app-conversations/start-tasks?ids=start-task-2"
      ) {
        return jsonResponse([
          {
            id: "start-task-2",
            status: "READY",
            app_conversation_id: "conversation-2",
          },
        ]);
      }

      throw new Error(`Unexpected request: ${input}`);
    };
    const adapter = new HttpOpenHandsAdapter({
      baseUrl: "https://openhands.example",
      fetch,
      startTaskPollIntervalMs: 0,
    });

    await expect(
      adapter.createConversation({
        taskId: "task-2",
        runId: "run-2",
        repo: "repo-2",
        prompt: "Fix another task",
      }),
    ).resolves.toMatchObject({ id: "conversation-2" });
    expect(requests).toEqual([
      "https://openhands.example/api/v1/app-conversations",
      "https://openhands.example/api/v1/app-conversations/start-tasks?ids=start-task-2",
    ]);
  });

  it("supports legacy endpoint paths for old V0-compatible servers", async () => {
    const requests: string[] = [];
    const fetch = async (input: string) => {
      requests.push(input);

      if (input === "https://openhands.example/api/conversations") {
        return jsonResponse({
          conversation: {
            id: "conversation-2",
          },
        });
      }

      if (input === "https://openhands.example/api/runs") {
        return jsonResponse({ ok: true });
      }

      throw new Error(`Unexpected request: ${input}`);
    };
    const adapter = new HttpOpenHandsAdapter({
      baseUrl: "https://openhands.example",
      fetch,
      apiMode: "legacy",
    });

    const conversation = await adapter.createConversation({
      taskId: "task-2",
      runId: "run-2",
      repo: "repo-2",
      prompt: "Fix another task",
    });
    await adapter.startRun(conversation.id);

    expect(requests).toEqual([
      "https://openhands.example/api/conversations",
      "https://openhands.example/api/runs",
    ]);
  });
});

function jsonResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  };
}
