import { describe, expect, it } from "vitest";
import {
  LangfuseHttpAdapter,
  MockLangfuseAdapter,
  costBreakdown,
  tokenUsage,
} from "../src/index.js";

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

describe("LangfuseHttpAdapter", () => {
  it("uses basic auth and sends trace/generation task payloads", async () => {
    const requests: Array<{
      input: string;
      init?: { method?: string; headers?: Record<string, string>; body?: string };
    }> = [];
    const fetch = async (
      input: string,
      init?: { method?: string; headers?: Record<string, string>; body?: string },
    ) => {
      requests.push({ input, init });

      if (input === "https://langfuse.example/api/public/traces") {
        return jsonResponse({
          id: "trace-1",
          url: "https://langfuse.example/trace/trace-1",
        });
      }

      if (input === "https://langfuse.example/api/public/generations") {
        return jsonResponse({ id: "generation-1" });
      }

      if (input === "https://langfuse.example/api/public/traces/trace-1") {
        return jsonResponse({ ok: true });
      }

      throw new Error(`Unexpected request: ${input}`);
    };
    const adapter = new LangfuseHttpAdapter({
      baseUrl: "https://langfuse.example/",
      publicKey: "pk",
      secretKey: "sk",
      fetch,
    });

    const trace = await adapter.createTrace({
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
    await adapter.createGeneration({
      traceId: trace.traceId,
      name: "llm-call",
      model: "gpt-5.5",
      input: { prompt: "Fix" },
      output: { text: "Done" },
      usage: tokenUsage(11, 7),
      cost: costBreakdown(0.01, 0.02),
      latencyMs: 1234,
    });
    const summary = await adapter.finishTrace(trace.traceId, { status: "completed" });

    expect(
      requests.every((request) => request.init?.headers?.authorization === "Basic cGs6c2s="),
    ).toBe(true);
    expect(JSON.parse(requests[0].init?.body ?? "{}")).toMatchObject({
      name: "development-run",
      metadata: {
        promptReleaseId: "prompt-release-1",
        task: "task-1",
        run: "run-1",
        repo: "traffic",
        role: "Development",
      },
    });
    expect(JSON.parse(requests[1].init?.body ?? "{}")).toMatchObject({
      traceId: "trace-1",
      model: "gpt-5.5",
      usage: {
        inputTokens: 11,
        outputTokens: 7,
        totalTokens: 18,
        tokens: 18,
      },
      cost: {
        inputCostUsd: 0.01,
        outputCostUsd: 0.02,
        totalCostUsd: 0.03,
      },
      metadata: {
        promptReleaseId: "prompt-release-1",
        task: "task-1",
        run: "run-1",
        repo: "traffic",
        role: "Development",
      },
    });
    expect(JSON.parse(requests[2].init?.body ?? "{}")).toEqual({
      output: { status: "completed" },
    });
    expect(summary).toMatchObject({
      trace: { traceId: "trace-1" },
      usage: { inputTokens: 11, outputTokens: 7, totalTokens: 18 },
      generationCount: 1,
    });
  });

  it("supports custom endpoint paths without losing defaults", async () => {
    const requests: string[] = [];
    const fetch = async (input: string) => {
      requests.push(input);

      if (input === "https://langfuse.example/v1/traces") {
        return jsonResponse({
          id: "trace-2",
          url: "https://langfuse.example/trace/trace-2",
        });
      }

      if (input === "https://langfuse.example/api/public/generations") {
        return jsonResponse({ id: "generation-2" });
      }

      throw new Error(`Unexpected request: ${input}`);
    };
    const adapter = new LangfuseHttpAdapter({
      baseUrl: "https://langfuse.example",
      publicKey: "pk",
      secretKey: "sk",
      fetch,
      endpoints: {
        traces: "/v1/traces",
      },
    });

    const trace = await adapter.createTrace({
      name: "custom-path-run",
      metadata: {
        taskId: "task-2",
        runId: "run-2",
        repo: "traffic",
        role: "Development",
        model: "gpt-5.5",
      },
    });
    await adapter.createGeneration({
      traceId: trace.traceId,
      name: "llm-call",
      model: "gpt-5.5",
      usage: tokenUsage(1, 1),
    });

    expect(requests).toEqual([
      "https://langfuse.example/v1/traces",
      "https://langfuse.example/api/public/generations",
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
