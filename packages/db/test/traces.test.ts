import { describe, expect, it, vi } from "vitest";
import { insertTraceRef } from "../src/traces";
import type { DatabaseClient } from "../src/client";

describe("insertTraceRef", () => {
  it("inserts a trace ref and updates run token/cost summary", async () => {
    const createdAt = new Date("2026-06-19T10:00:00Z");
    const client = {
      query: vi.fn().mockResolvedValue({
        rows: [
          {
            id: "trace-ref-1",
            run_id: "run-1",
            provider: "mock-langfuse",
            trace_id: "trace-1",
            generation_id: "generation-1",
            model: "mock-model",
            prompt_release_id: "prompt-1",
            input_tokens: "10",
            output_tokens: "20",
            cost_usd: "0.010000",
            latency_ms: 50,
            ui_url: "http://localhost/traces/trace-1",
            created_at: createdAt,
          },
        ],
      }),
    } as unknown as DatabaseClient;

    await expect(
      insertTraceRef(client, {
        runId: "run-1",
        provider: "mock-langfuse",
        traceId: "trace-1",
        generationId: "generation-1",
        model: "mock-model",
        promptReleaseId: "prompt-1",
        inputTokens: 10,
        outputTokens: 20,
        costUsd: "0.010000",
        latencyMs: 50,
        uiUrl: "http://localhost/traces/trace-1",
      }),
    ).resolves.toEqual({
      id: "trace-ref-1",
      runId: "run-1",
      provider: "mock-langfuse",
      traceId: "trace-1",
      generationId: "generation-1",
      model: "mock-model",
      promptReleaseId: "prompt-1",
      inputTokens: 10,
      outputTokens: 20,
      costUsd: "0.010000",
      latencyMs: 50,
      uiUrl: "http://localhost/traces/trace-1",
      createdAt,
    });

    expect(client.query).toHaveBeenCalledWith(expect.stringContaining("insert into trace_refs"), [
      "run-1",
      "mock-langfuse",
      "trace-1",
      "generation-1",
      "mock-model",
      "prompt-1",
      10,
      20,
      "0.010000",
      50,
      "http://localhost/traces/trace-1",
      30,
    ]);
  });
});
