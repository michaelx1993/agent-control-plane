import { describe, expect, it } from "vitest";
import { MockOpenHandsAdapter } from "../src/index.js";

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
