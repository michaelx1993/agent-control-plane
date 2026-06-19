export type ConversationRef = {
  id: string;
  url?: string;
  workspacePath?: string;
  repo: string;
  taskId: string;
  runId: string;
};

export type StartConversationInput = {
  taskId: string;
  runId: string;
  repo: string;
  workspacePath?: string;
  prompt: string;
  metadata?: Record<string, string>;
};

export type OpenHandsEvent =
  | {
      id: string;
      conversationId: string;
      type: "agent.message";
      message: string;
      createdAt: string;
    }
  | {
      id: string;
      conversationId: string;
      type: "tool.call";
      toolName: string;
      input?: unknown;
      createdAt: string;
    }
  | {
      id: string;
      conversationId: string;
      type: "tool.result";
      toolName: string;
      output?: unknown;
      createdAt: string;
    }
  | {
      id: string;
      conversationId: string;
      type: "run.status";
      status: OpenHandsRunStatus;
      createdAt: string;
    };

export type OpenHandsRunStatus = "queued" | "running" | "completed" | "failed" | "stuck";

export type OpenHandsRunResult = {
  conversationId: string;
  status: Extract<OpenHandsRunStatus, "completed" | "failed" | "stuck">;
  summary: string;
  eventCursor?: string;
  error?: string;
  artifacts?: Array<{ kind: string; url?: string; path?: string }>;
};

export type OpenHandsAdapter = {
  createConversation(input: StartConversationInput): Promise<ConversationRef>;
  startRun(conversationId: string): Promise<void>;
  listEvents(
    conversationId: string,
    cursor?: string,
  ): Promise<{ events: OpenHandsEvent[]; nextCursor?: string }>;
  getResult(conversationId: string): Promise<OpenHandsRunResult | undefined>;
};

export type OpenHandsHttpEndpoints = {
  conversations: string;
  runs: string;
};

export type OpenHandsHttpAdapterOptions = {
  baseUrl: string;
  fetch?: FetchLike;
  headers?: Record<string, string>;
  endpoints?: Partial<OpenHandsHttpEndpoints>;
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

const defaultOpenHandsEndpoints: OpenHandsHttpEndpoints = {
  // Skeleton defaults only. Align these with the target self-host/OpenHands SDK Server routes.
  conversations: "/api/conversations",
  runs: "/api/runs",
};

export class HttpOpenHandsAdapter implements OpenHandsAdapter {
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;
  private readonly headers: Record<string, string>;
  private readonly endpoints: OpenHandsHttpEndpoints;

  constructor(options: OpenHandsHttpAdapterOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.fetchImpl = options.fetch ?? defaultFetch;
    this.headers = options.headers ?? {};
    this.endpoints = {
      conversations: options.endpoints?.conversations ?? defaultOpenHandsEndpoints.conversations,
      runs: options.endpoints?.runs ?? defaultOpenHandsEndpoints.runs,
    };
  }

  async createConversation(input: StartConversationInput): Promise<ConversationRef> {
    const response = await this.request("POST", this.endpoints.conversations, input);
    const body = unwrapObject(response, "conversation");

    return {
      id: readString(body, "id"),
      url: readOptionalString(body, "url"),
      workspacePath: readOptionalString(body, "workspacePath") ?? input.workspacePath,
      repo: readOptionalString(body, "repo") ?? input.repo,
      taskId: readOptionalString(body, "taskId") ?? input.taskId,
      runId: readOptionalString(body, "runId") ?? input.runId,
    };
  }

  async startRun(conversationId: string): Promise<void> {
    await this.request("POST", this.endpoints.runs, { conversationId });
  }

  async listEvents(
    conversationId: string,
    cursor?: string,
  ): Promise<{ events: OpenHandsEvent[]; nextCursor?: string }> {
    const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
    const response = await this.request(
      "GET",
      `${this.endpoints.conversations}/${encodeURIComponent(conversationId)}/events${query}`,
    );
    const body = asRecord(response);
    const rawEvents = readArray(body, "events") ?? readArray(body, "data") ?? [];

    return {
      events: rawEvents.map(parseOpenHandsEvent),
      nextCursor: readOptionalString(body, "nextCursor") ?? readOptionalString(body, "cursor"),
    };
  }

  async getResult(conversationId: string): Promise<OpenHandsRunResult | undefined> {
    const response = await this.request(
      "GET",
      `${this.endpoints.runs}/${encodeURIComponent(conversationId)}/result`,
    );
    const body = asRecord(response);
    const rawResult = body.result === undefined ? response : body.result;
    if (rawResult === null || rawResult === undefined) return undefined;
    return parseOpenHandsRunResult(rawResult, conversationId);
  }

  private async request(method: string, path: string, body?: unknown): Promise<unknown> {
    const response = await this.fetchImpl(`${this.baseUrl}${normalizePath(path)}`, {
      method,
      headers: {
        "content-type": "application/json",
        ...this.headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`OpenHands request failed: ${response.status} ${response.statusText ?? ""}`);
    }

    return response.json();
  }
}

export class MockOpenHandsAdapter implements OpenHandsAdapter {
  private conversations = new Map<string, ConversationRef>();
  private events = new Map<string, OpenHandsEvent[]>();
  private results = new Map<string, OpenHandsRunResult>();
  private sequence = 0;

  constructor(private readonly baseUrl = "http://openhands.local") {}

  async createConversation(input: StartConversationInput): Promise<ConversationRef> {
    const id = `mock-conversation-${++this.sequence}`;
    const ref: ConversationRef = {
      id,
      url: `${this.baseUrl.replace(/\/+$/, "")}/conversations/${id}`,
      workspacePath: input.workspacePath,
      repo: input.repo,
      taskId: input.taskId,
      runId: input.runId,
    };

    this.conversations.set(id, ref);
    this.events.set(id, [
      this.event(id, "run.status", { status: "queued" }),
      this.event(id, "agent.message", { message: input.prompt }),
    ]);

    return ref;
  }

  async startRun(conversationId: string): Promise<void> {
    this.assertConversation(conversationId);
    this.appendEvent(
      conversationId,
      this.event(conversationId, "run.status", { status: "running" }),
    );
  }

  async listEvents(
    conversationId: string,
    cursor?: string,
  ): Promise<{ events: OpenHandsEvent[]; nextCursor?: string }> {
    this.assertConversation(conversationId);
    const allEvents = this.events.get(conversationId) ?? [];
    const start = cursor ? Number.parseInt(cursor, 10) : 0;
    const safeStart = Number.isFinite(start) && start > 0 ? start : 0;
    const events = allEvents.slice(safeStart);
    const nextCursor = String(safeStart + events.length);

    return { events, nextCursor };
  }

  async getResult(conversationId: string): Promise<OpenHandsRunResult | undefined> {
    this.assertConversation(conversationId);
    return this.results.get(conversationId);
  }

  completeRun(
    conversationId: string,
    result: Omit<OpenHandsRunResult, "conversationId" | "status"> & {
      status?: OpenHandsRunResult["status"];
    },
  ): OpenHandsRunResult {
    this.assertConversation(conversationId);
    const completed: OpenHandsRunResult = {
      conversationId,
      status: result.status ?? "completed",
      summary: result.summary,
      eventCursor: result.eventCursor,
      error: result.error,
      artifacts: result.artifacts,
    };

    this.results.set(conversationId, completed);
    this.appendEvent(
      conversationId,
      this.event(conversationId, "run.status", { status: completed.status }),
    );
    return completed;
  }

  appendToolCall(conversationId: string, toolName: string, input?: unknown): OpenHandsEvent {
    this.assertConversation(conversationId);
    const event = this.event(conversationId, "tool.call", { toolName, input });
    this.appendEvent(conversationId, event);
    return event;
  }

  private appendEvent(conversationId: string, event: OpenHandsEvent): void {
    this.events.set(conversationId, [...(this.events.get(conversationId) ?? []), event]);
  }

  private assertConversation(conversationId: string): void {
    if (!this.conversations.has(conversationId)) {
      throw new Error(`Unknown OpenHands conversation: ${conversationId}`);
    }
  }

  private event(
    conversationId: string,
    type: "agent.message",
    data: { message: string },
  ): OpenHandsEvent;
  private event(
    conversationId: string,
    type: "tool.call",
    data: { toolName: string; input?: unknown },
  ): OpenHandsEvent;
  private event(
    conversationId: string,
    type: "run.status",
    data: { status: OpenHandsRunStatus },
  ): OpenHandsEvent;
  private event(
    conversationId: string,
    type: "agent.message" | "tool.call" | "run.status",
    data: { message?: string; toolName?: string; input?: unknown; status?: OpenHandsRunStatus },
  ): OpenHandsEvent {
    const base = {
      id: `mock-event-${++this.sequence}`,
      conversationId,
      createdAt: new Date(0).toISOString(),
    };

    if (type === "agent.message") return { ...base, type, message: data.message ?? "" };
    if (type === "tool.call")
      return { ...base, type, toolName: data.toolName ?? "unknown", input: data.input };
    return { ...base, type, status: data.status ?? "queued" };
  }
}

function defaultFetch(...args: Parameters<FetchLike>): ReturnType<FetchLike> {
  const fetchImpl = (globalThis as unknown as { fetch?: FetchLike }).fetch;
  if (!fetchImpl) throw new Error("No fetch implementation available for HttpOpenHandsAdapter");
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
    throw new Error(`OpenHands response missing string field: ${key}`);
  }
  return value;
}

function readOptionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

function readArray(record: Record<string, unknown>, key: string): unknown[] | undefined {
  const value = record[key];
  return Array.isArray(value) ? value : undefined;
}

function parseOpenHandsEvent(value: unknown): OpenHandsEvent {
  const event = asRecord(value);
  const type = readString(event, "type") as OpenHandsEvent["type"];
  const base = {
    id: readString(event, "id"),
    conversationId: readString(event, "conversationId"),
    createdAt: readString(event, "createdAt"),
  };

  if (type === "agent.message") return { ...base, type, message: readString(event, "message") };
  if (type === "tool.call") {
    return {
      ...base,
      type,
      toolName: readString(event, "toolName"),
      input: event.input,
    };
  }
  if (type === "tool.result") {
    return {
      ...base,
      type,
      toolName: readString(event, "toolName"),
      output: event.output,
    };
  }
  if (type === "run.status") {
    return { ...base, type, status: readRunStatus(event, "status") };
  }

  throw new Error(`Unsupported OpenHands event type: ${type}`);
}

function parseOpenHandsRunResult(
  value: unknown,
  fallbackConversationId: string,
): OpenHandsRunResult {
  const result = asRecord(value);
  const conversationId = readOptionalString(result, "conversationId") ?? fallbackConversationId;
  const status = readRunStatus(result, "status");
  if (status !== "completed" && status !== "failed" && status !== "stuck") {
    throw new Error(`OpenHands result status is not terminal: ${status}`);
  }

  return {
    conversationId,
    status,
    summary: readString(result, "summary"),
    eventCursor: readOptionalString(result, "eventCursor"),
    error: readOptionalString(result, "error"),
    artifacts: readArtifacts(result.artifacts),
  };
}

function readRunStatus(record: Record<string, unknown>, key: string): OpenHandsRunStatus {
  const value = readString(record, key);
  if (
    value === "queued" ||
    value === "running" ||
    value === "completed" ||
    value === "failed" ||
    value === "stuck"
  ) {
    return value;
  }
  throw new Error(`Unsupported OpenHands run status: ${value}`);
}

function readArtifacts(value: unknown): OpenHandsRunResult["artifacts"] {
  if (!Array.isArray(value)) return undefined;
  return value.map((artifact) => {
    const record = asRecord(artifact);
    return {
      kind: readString(record, "kind"),
      url: readOptionalString(record, "url"),
      path: readOptionalString(record, "path"),
    };
  });
}
