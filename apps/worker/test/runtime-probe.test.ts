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

      if (input === "https://openhands.test/api/v1/app-conversations") {
        return jsonResponse({
          id: "start-task-1",
          status: "READY",
          app_conversation_id: "conversation-1",
        });
      }

      if (
        input ===
        "https://openhands.test/api/v1/conversation/conversation-1/events/search?limit=100"
      ) {
        return jsonResponse({
          items: [
            {
              id: "event-1",
              conversation_id: "conversation-1",
              type: "run.status",
              status: "completed",
              timestamp: "2026-06-19T00:00:00.000Z",
            },
          ],
          nextCursor: "1",
        });
      }

      if (input === "https://openhands.test/api/v1/app-conversations?ids=conversation-1") {
        return jsonResponse([
          {
            id: "conversation-1",
            sandbox_status: "RUNNING",
            execution_status: "finished",
            title: "Runtime probe completed.",
          },
        ]);
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
      "https://openhands.test/api/v1/app-conversations",
      "https://openhands.test/api/v1/conversation/conversation-1/events/search?limit=100",
      "https://openhands.test/api/v1/app-conversations?ids=conversation-1",
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
