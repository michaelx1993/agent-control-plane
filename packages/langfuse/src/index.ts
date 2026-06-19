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

export type LangfuseHttpEndpoints = {
  traces: string;
  generations: string;
};

export type LangfuseHttpAdapterOptions = {
  baseUrl: string;
  publicKey: string;
  secretKey: string;
  fetch?: FetchLike;
  endpoints?: Partial<LangfuseHttpEndpoints>;
};

type FetchLike = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  },
) => Promise<{
  ok: boolean;
  status: number;
  statusText?: string;
  json(): Promise<unknown>;
}>;

const defaultLangfuseEndpoints: LangfuseHttpEndpoints = {
  traces: "/api/public/traces",
  generations: "/api/public/generations",
};

export class LangfuseHttpAdapter implements LangfuseAdapter {
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;
  private readonly endpoints: LangfuseHttpEndpoints;
  private readonly authHeader: string;
  private readonly traces = new Map<string, TraceRef>();
  private readonly traceMetadata = new Map<string, TraceMetadata>();
  private readonly generations = new Map<string, RecordGenerationInput[]>();
  private readonly summaries = new Map<string, TraceCostSummary>();

  constructor(options: LangfuseHttpAdapterOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.fetchImpl = options.fetch ?? defaultFetch;
    this.endpoints = {
      traces: options.endpoints?.traces ?? defaultLangfuseEndpoints.traces,
      generations: options.endpoints?.generations ?? defaultLangfuseEndpoints.generations,
    };
    this.authHeader = `Basic ${base64Encode(`${options.publicKey}:${options.secretKey}`)}`;
  }

  async startTrace(input: StartTraceInput): Promise<TraceRef> {
    return this.createTrace(input);
  }

  async createTrace(input: StartTraceInput): Promise<TraceRef> {
    const response = await this.request("POST", this.endpoints.traces, {
      name: input.name,
      metadata: traceMetadataPayload(input.metadata),
    });
    const body = unwrapObject(response, "trace");
    const traceId = readOptionalString(body, "traceId") ?? readString(body, "id");
    const trace: TraceRef = {
      traceId,
      url: readOptionalString(body, "url"),
      taskId: input.metadata.taskId,
      runId: input.metadata.runId,
      conversationId: input.metadata.conversationId,
      promptReleaseId: input.metadata.promptReleaseId,
    };

    this.traces.set(traceId, trace);
    this.traceMetadata.set(traceId, input.metadata);
    this.generations.set(traceId, []);
    return trace;
  }

  async recordGeneration(input: RecordGenerationInput): Promise<void> {
    await this.createGeneration(input);
  }

  async record(input: RecordGenerationInput): Promise<void> {
    await this.createGeneration(input);
  }

  async createGeneration(input: RecordGenerationInput): Promise<void> {
    const metadata = this.traceMetadata.get(input.traceId);
    await this.request("POST", this.endpoints.generations, {
      traceId: input.traceId,
      name: input.name,
      model: input.model,
      input: input.input,
      output: input.output,
      usage: usagePayload(input.usage),
      cost: input.cost,
      latencyMs: input.latencyMs,
      metadata: metadata ? traceMetadataPayload(metadata) : undefined,
    });

    this.generations.set(input.traceId, [...(this.generations.get(input.traceId) ?? []), input]);
  }

  async finishTrace(traceId: string, output?: unknown): Promise<TraceCostSummary> {
    const trace = this.traces.get(traceId);
    if (!trace) throw new Error(`Unknown Langfuse trace: ${traceId}`);

    await this.request("PATCH", `${this.endpoints.traces}/${encodeURIComponent(traceId)}`, {
      output,
    });

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
    const cached = this.summaries.get(traceId);
    if (cached) return cached;

    const response = await this.request(
      "GET",
      `${this.endpoints.traces}/${encodeURIComponent(traceId)}`,
    );
    const body = asRecord(response);
    if (Object.keys(body).length === 0) return undefined;
    return parseTraceCostSummary(body, this.traces.get(traceId));
  }

  private async request(method: string, path: string, body?: unknown): Promise<unknown> {
    const response = await this.fetchImpl(`${this.baseUrl}${normalizePath(path)}`, {
      method,
      headers: {
        authorization: this.authHeader,
        "content-type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`Langfuse request failed: ${response.status} ${response.statusText ?? ""}`);
    }

    return response.json();
  }
}

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

function defaultFetch(...args: Parameters<FetchLike>): ReturnType<FetchLike> {
  const fetchImpl = (globalThis as unknown as { fetch?: FetchLike }).fetch;
  if (!fetchImpl) throw new Error("No fetch implementation available for LangfuseHttpAdapter");
  return fetchImpl(...args);
}

function normalizePath(path: string): string {
  return path.startsWith("/") ? path : `/${path}`;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function unwrapObject(value: unknown, key: string): Record<string, unknown> {
  const body = asRecord(value);
  const nested = body[key];
  return nested && typeof nested === "object" ? (nested as Record<string, unknown>) : body;
}

function readString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Langfuse response missing string field: ${key}`);
  }
  return value;
}

function readOptionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

function readNumber(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  if (typeof value !== "number") throw new Error(`Langfuse response missing number field: ${key}`);
  return value;
}

function traceMetadataPayload(metadata: TraceMetadata): Record<string, unknown> {
  return {
    ...metadata,
    task: metadata.taskId,
    run: metadata.runId,
    repo: metadata.repo,
    role: metadata.role,
    promptReleaseId: metadata.promptReleaseId,
  };
}

function usagePayload(usage: TokenUsage): Record<string, number> {
  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
    tokens: usage.totalTokens,
  };
}

function parseTraceCostSummary(value: unknown, fallbackTrace?: TraceRef): TraceCostSummary {
  const body = asRecord(value);
  const traceBody = unwrapObject(body.trace ?? body, "trace");
  const trace: TraceRef = fallbackTrace ?? {
    traceId: readOptionalString(traceBody, "traceId") ?? readString(traceBody, "id"),
    url: readOptionalString(traceBody, "url"),
    taskId: readString(traceBody, "taskId"),
    runId: readString(traceBody, "runId"),
    conversationId: readOptionalString(traceBody, "conversationId"),
    promptReleaseId: readOptionalString(traceBody, "promptReleaseId"),
  };

  return {
    trace,
    usage: parseUsage(body.usage),
    cost: parseCost(body.cost),
    generationCount: readNumber(body, "generationCount"),
  };
}

function parseUsage(value: unknown): TokenUsage {
  const usage = asRecord(value);
  return {
    inputTokens: readNumber(usage, "inputTokens"),
    outputTokens: readNumber(usage, "outputTokens"),
    totalTokens: readNumber(usage, "totalTokens"),
  };
}

function parseCost(value: unknown): CostBreakdown {
  const cost = asRecord(value);
  return {
    inputCostUsd: readNumber(cost, "inputCostUsd"),
    outputCostUsd: readNumber(cost, "outputCostUsd"),
    totalCostUsd: readNumber(cost, "totalCostUsd"),
    currency: "USD",
  };
}

function base64Encode(value: string): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let output = "";

  for (let index = 0; index < value.length; index += 3) {
    const first = value.charCodeAt(index);
    const second = index + 1 < value.length ? value.charCodeAt(index + 1) : 0;
    const third = index + 2 < value.length ? value.charCodeAt(index + 2) : 0;
    const combined = (first << 16) | (second << 8) | third;

    output += alphabet[(combined >> 18) & 63];
    output += alphabet[(combined >> 12) & 63];
    output += index + 1 < value.length ? alphabet[(combined >> 6) & 63] : "=";
    output += index + 2 < value.length ? alphabet[combined & 63] : "=";
  }

  return output;
}
