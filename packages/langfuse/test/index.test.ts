import { describe, expect, it } from "vitest";
import { MockLangfuseAdapter, costBreakdown, tokenUsage } from "../src/index.js";

describe("MockLangfuseAdapter", () => {
  it("stores trace refs and aggregates token/cost summaries", async () => {
    const adapter = new MockLangfuseAdapter("https://langfuse.example");

    const trace = await adapter.startTrace({
      name: "development-run",
      metadata: {
        taskId: "task-1",
        runId: "run-1",
        conversationId: "conversation-1",
        promptReleaseId: "prompt-release-1",
        repo: "traffic",
        role: "Development",
        model: "gpt-5.5",
      },
    });

    await adapter.recordGeneration({
      traceId: trace.traceId,
      name: "llm-call",
      model: "gpt-5.5",
      usage: tokenUsage(100, 25),
      cost: costBreakdown(0.01, 0.02),
    });

    const summary = await adapter.finishTrace(trace.traceId);

    expect(trace.url).toBe("https://langfuse.example/trace/mock-trace-1");
    expect(summary.usage).toEqual({ inputTokens: 100, outputTokens: 25, totalTokens: 125 });
    expect(summary.cost.totalCostUsd).toBe(0.03);
    await expect(adapter.getTraceSummary(trace.traceId)).resolves.toEqual(summary);
  });
});
