import { describe, expect, it } from "vitest";

import { runRuntimeProbe } from "../src/runtime-probe.js";

describe("Runtime probe", () => {
  it("requires explicit mutating mode", async () => {
    await expect(runRuntimeProbe({ env: {} })).resolves.toMatchObject({
      status: "not_ready",
      mutating: false,
      steps: [
        {
          id: "config",
          status: "fail",
        },
      ],
    });
  });

  it("creates OpenHands run evidence and Langfuse trace evidence", async () => {
    const requests: Array<{ input: string; init?: { method?: string; body?: string } }> = [];
    const fetch = async (input: string, init?: { method?: string; body?: string }) => {
      requests.push({ input, init });

      if (input === "https://openhands.test/api/conversations") {
        return jsonResponse({
          conversation: {
            id: "conversation-1",
            url: "https://openhands.test/conversations/conversation-1",
          },
        });
      }

      if (input === "https://openhands.test/api/runs") {
        return jsonResponse({ ok: true });
      }

      if (input === "https://openhands.test/api/conversations/conversation-1/events") {
        return jsonResponse({
          events: [
            {
              id: "event-1",
              conversationId: "conversation-1",
              type: "run.status",
              status: "completed",
              createdAt: "2026-06-19T00:00:00.000Z",
            },
          ],
          nextCursor: "1",
        });
      }

      if (input === "https://openhands.test/api/runs/conversation-1/result") {
        return jsonResponse({
          result: {
            conversationId: "conversation-1",
            status: "completed",
            summary: "Runtime probe completed.",
          },
        });
      }

      if (input === "https://langfuse.test/api/public/traces") {
        return jsonResponse({
          id: "trace-1",
          url: "https://langfuse.test/trace/trace-1",
        });
      }

      if (input === "https://langfuse.test/api/public/generations") {
        return jsonResponse({ id: "generation-1" });
      }

      if (input === "https://langfuse.test/api/public/traces/trace-1") {
        return jsonResponse({ ok: true });
      }

      throw new Error(`Unexpected request: ${input}`);
    };

    const report = await runRuntimeProbe({
      env: {
        RUNTIME_PROBE_MUTATE: "true",
        RUNTIME_PROBE_OPENHANDS_POLL_INTERVAL_MS: "0",
        OPENHANDS_BASE_URL: "https://openhands.test",
        LANGFUSE_BASE_URL: "https://langfuse.test",
        LANGFUSE_PUBLIC_KEY: "pk",
        LANGFUSE_SECRET_KEY: "sk",
      },
      fetch: fetch as unknown as typeof globalThis.fetch,
      now: () => new Date("2026-06-19T00:00:00.000Z"),
    });

    expect(report).toMatchObject({
      status: "ready",
      mutating: true,
      steps: [
        expect.objectContaining({ id: "openhands:start", status: "pass" }),
        expect.objectContaining({ id: "openhands:result", status: "pass" }),
        expect.objectContaining({ id: "langfuse:trace", status: "pass" }),
      ],
    });
    expect(requests.map((request) => request.input)).toEqual([
      "https://openhands.test/api/conversations",
      "https://openhands.test/api/runs",
      "https://openhands.test/api/conversations/conversation-1/events",
      "https://openhands.test/api/runs/conversation-1/result",
      "https://langfuse.test/api/public/traces",
      "https://langfuse.test/api/public/generations",
      "https://langfuse.test/api/public/traces/trace-1",
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
