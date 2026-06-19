export type TraceRef = {
  traceId: string;
  url?: string;
  taskId: string;
  runId: string;
  conversationId?: string;
  promptReleaseId?: string;
};

export type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

export type CostBreakdown = {
  inputCostUsd: number;
  outputCostUsd: number;
  totalCostUsd: number;
  currency: "USD";
};

export type TraceMetadata = {
  taskId: string;
  runId: string;
  repo: string;
  role: string;
  model: string;
  agentDefinitionId?: string;
  conversationId?: string;
  promptReleaseId?: string;
};

export type StartTraceInput = {
  name: string;
  metadata: TraceMetadata;
};

export type RecordGenerationInput = {
  traceId: string;
  name: string;
  model: string;
  input?: unknown;
  output?: unknown;
  usage: TokenUsage;
  cost?: CostBreakdown;
  latencyMs?: number;
};

export type TraceCostSummary = {
  trace: TraceRef;
  usage: TokenUsage;
  cost: CostBreakdown;
  generationCount: number;
};

export type LangfuseAdapter = {
  startTrace(input: StartTraceInput): Promise<TraceRef>;
  recordGeneration(input: RecordGenerationInput): Promise<void>;
  finishTrace(traceId: string, output?: unknown): Promise<TraceCostSummary>;
  getTraceSummary(traceId: string): Promise<TraceCostSummary | undefined>;
};

export class MockLangfuseAdapter implements LangfuseAdapter {
  private traces = new Map<string, TraceRef>();
  private generations = new Map<string, RecordGenerationInput[]>();
  private summaries = new Map<string, TraceCostSummary>();
  private sequence = 0;

  constructor(private readonly baseUrl = "http://langfuse.local") {}

  async startTrace(input: StartTraceInput): Promise<TraceRef> {
    const traceId = `mock-trace-${++this.sequence}`;
    const trace: TraceRef = {
      traceId,
      url: `${this.baseUrl.replace(/\/+$/, "")}/trace/${traceId}`,
      taskId: input.metadata.taskId,
      runId: input.metadata.runId,
      conversationId: input.metadata.conversationId,
      promptReleaseId: input.metadata.promptReleaseId,
    };

    this.traces.set(traceId, trace);
    this.generations.set(traceId, []);
    return trace;
  }

  async recordGeneration(input: RecordGenerationInput): Promise<void> {
    if (!this.traces.has(input.traceId)) {
      throw new Error(`Unknown Langfuse trace: ${input.traceId}`);
    }

    this.generations.set(input.traceId, [...(this.generations.get(input.traceId) ?? []), input]);
  }

  async finishTrace(traceId: string): Promise<TraceCostSummary> {
    const trace = this.traces.get(traceId);
    if (!trace) {
      throw new Error(`Unknown Langfuse trace: ${traceId}`);
    }

    const generations = this.generations.get(traceId) ?? [];
    const summary: TraceCostSummary = {
      trace,
      usage: sumUsage(generations.map((generation) => generation.usage)),
      cost: sumCost(generations.map((generation) => generation.cost ?? zeroCost())),
      generationCount: generations.length,
    };

    this.summaries.set(traceId, summary);
    return summary;
  }

  async getTraceSummary(traceId: string): Promise<TraceCostSummary | undefined> {
    return this.summaries.get(traceId);
  }
}

export function tokenUsage(inputTokens: number, outputTokens: number): TokenUsage {
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
  };
}

export function costBreakdown(inputCostUsd: number, outputCostUsd: number): CostBreakdown {
  return {
    inputCostUsd,
    outputCostUsd,
    totalCostUsd: inputCostUsd + outputCostUsd,
    currency: "USD",
  };
}

function sumUsage(usages: TokenUsage[]): TokenUsage {
  return usages.reduce(
    (acc, usage) => ({
      inputTokens: acc.inputTokens + usage.inputTokens,
      outputTokens: acc.outputTokens + usage.outputTokens,
      totalTokens: acc.totalTokens + usage.totalTokens,
    }),
    { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
  );
}

function sumCost(costs: CostBreakdown[]): CostBreakdown {
  return costs.reduce(
    (acc, cost) => ({
      inputCostUsd: acc.inputCostUsd + cost.inputCostUsd,
      outputCostUsd: acc.outputCostUsd + cost.outputCostUsd,
      totalCostUsd: acc.totalCostUsd + cost.totalCostUsd,
      currency: "USD",
    }),
    zeroCost(),
  );
}

function zeroCost(): CostBreakdown {
  return { inputCostUsd: 0, outputCostUsd: 0, totalCostUsd: 0, currency: "USD" };
}
