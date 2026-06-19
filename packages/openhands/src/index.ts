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
  startTasks: string;
  eventsSearch: string;
};

export type OpenHandsHttpApiMode = "v1" | "legacy";

export type OpenHandsHttpAdapterOptions = {
  baseUrl: string;
  fetch?: FetchLike;
  headers?: Record<string, string>;
  endpoints?: Partial<OpenHandsHttpEndpoints>;
  apiMode?: OpenHandsHttpApiMode;
  startTaskPollAttempts?: number;
  startTaskPollIntervalMs?: number;
  sleep?: (ms: number) => Promise<void>;
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
  conversations: "/api/v1/app-conversations",
  runs: "/api/v1/app-conversations",
  startTasks: "/api/v1/app-conversations/start-tasks",
  eventsSearch: "/api/v1/conversation/{conversationId}/events/search",
};

const legacyOpenHandsEndpoints: OpenHandsHttpEndpoints = {
  conversations: "/api/conversations",
  runs: "/api/runs",
  startTasks: "/api/conversations/start-tasks",
  eventsSearch: "/api/conversations/{conversationId}/events",
};

export class HttpOpenHandsAdapter implements OpenHandsAdapter {
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;
  private readonly headers: Record<string, string>;
  private readonly endpoints: OpenHandsHttpEndpoints;
  private readonly apiMode: OpenHandsHttpApiMode;
  private readonly startTaskPollAttempts: number;
  private readonly startTaskPollIntervalMs: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(options: OpenHandsHttpAdapterOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.fetchImpl = options.fetch ?? defaultFetch;
    this.headers = options.headers ?? {};
    this.apiMode = options.apiMode ?? "v1";
    const defaults =
      this.apiMode === "legacy" ? legacyOpenHandsEndpoints : defaultOpenHandsEndpoints;
    this.endpoints = {
      conversations: options.endpoints?.conversations ?? defaults.conversations,
      runs: options.endpoints?.runs ?? defaults.runs,
      startTasks: options.endpoints?.startTasks ?? defaults.startTasks,
      eventsSearch: options.endpoints?.eventsSearch ?? defaults.eventsSearch,
    };
    this.startTaskPollAttempts = positiveInteger(options.startTaskPollAttempts, 60);
    this.startTaskPollIntervalMs = positiveInteger(options.startTaskPollIntervalMs, 5000);
    this.sleep = options.sleep ?? sleep;
  }

  async createConversation(input: StartConversationInput): Promise<ConversationRef> {
    if (this.apiMode === "legacy") {
      return this.createLegacyConversation(input);
    }

    const response = await this.request("POST", this.endpoints.conversations, {
      initial_message: {
        content: [{ type: "text", text: input.prompt }],
      },
      selected_repository: input.repo,
      metadata: input.metadata,
    });
    const startTask = unwrapObject(response, "start_task");
    const conversationId =
      readOptionalString(startTask, "app_conversation_id") ??
      readOptionalString(startTask, "conversation_id");
    if (conversationId) return this.v1ConversationRef(conversationId, input);

    const startTaskId = readString(startTask, "id");
    return this.pollV1ConversationStart(startTaskId, input);
  }

  private async createLegacyConversation(input: StartConversationInput): Promise<ConversationRef> {
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
    if (this.apiMode === "v1") {
      void conversationId;
      return;
    }

    await this.request("POST", this.endpoints.runs, { conversationId });
  }

  async listEvents(
    conversationId: string,
    cursor?: string,
  ): Promise<{ events: OpenHandsEvent[]; nextCursor?: string }> {
    if (this.apiMode === "legacy") {
      const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
      const response = await this.request(
        "GET",
        `${this.endpoints.conversations}/${encodeURIComponent(conversationId)}/events${query}`,
      );
      return this.parseEventsPage(response);
    }

    const query = new URLSearchParams({ limit: "100" });
    if (cursor) {
      query.set("page_id", cursor);
      query.set("cursor", cursor);
    }
    const response = await this.request(
      "GET",
      `${this.conversationPath(this.endpoints.eventsSearch, conversationId)}?${query.toString()}`,
    );
    return this.parseEventsPage(response);
  }

  private parseEventsPage(response: unknown): { events: OpenHandsEvent[]; nextCursor?: string } {
    const body = asRecord(response);
    const rawEvents =
      readArray(body, "events") ?? readArray(body, "items") ?? readArray(body, "data") ?? [];

    return {
      events: rawEvents.map(parseOpenHandsEvent),
      nextCursor:
        readOptionalString(body, "nextCursor") ??
        readOptionalString(body, "next_page_id") ??
        readOptionalString(body, "cursor"),
    };
  }

  async getResult(conversationId: string): Promise<OpenHandsRunResult | undefined> {
    if (this.apiMode === "v1") {
      const response = await this.request(
        "GET",
        `${this.endpoints.conversations}?ids=${encodeURIComponent(conversationId)}`,
      );
      return parseOpenHandsV1ConversationResult(response, conversationId);
    }

    const response = await this.request(
      "GET",
      `${this.endpoints.runs}/${encodeURIComponent(conversationId)}/result`,
    );
    const body = asRecord(response);
    const rawResult = body.result === undefined ? response : body.result;
    if (rawResult === null || rawResult === undefined) return undefined;
    return parseOpenHandsRunResult(rawResult, conversationId);
  }

  private async pollV1ConversationStart(
    startTaskId: string,
    input: StartConversationInput,
  ): Promise<ConversationRef> {
    for (let attempt = 0; attempt < this.startTaskPollAttempts; attempt += 1) {
      const response = await this.request(
        "GET",
        `${this.endpoints.startTasks}?ids=${encodeURIComponent(startTaskId)}`,
      );
      const task = firstRecord(response);
      const status = readOptionalString(task, "status");
      const conversationId =
        readOptionalString(task, "app_conversation_id") ??
        readOptionalString(task, "conversation_id");

      if (status === "READY" && conversationId) {
        return this.v1ConversationRef(conversationId, input);
      }
      if (status === "ERROR") {
        throw new Error(
          `OpenHands conversation start failed: ${readOptionalString(task, "error") ?? "unknown error"}`,
        );
      }
      if (this.startTaskPollIntervalMs > 0) {
        await this.sleep(this.startTaskPollIntervalMs);
      }
    }

    throw new Error(
      `OpenHands conversation start task ${startTaskId} did not become READY after ${this.startTaskPollAttempts} poll attempt(s).`,
    );
  }

  private v1ConversationRef(
    conversationId: string,
    input: StartConversationInput,
  ): ConversationRef {
    return {
      id: conversationId,
      url: `${this.baseUrl}/conversations/${conversationId}`,
      workspacePath: input.workspacePath,
      repo: input.repo,
      taskId: input.taskId,
      runId: input.runId,
    };
  }

  private conversationPath(path: string, conversationId: string): string {
    return path.replace("{conversationId}", encodeURIComponent(conversationId));
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && value !== undefined && value >= 0 ? Math.floor(value) : fallback;
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

function firstRecord(value: unknown): Record<string, unknown> {
  if (Array.isArray(value)) return asRecord(value[0]);
  const body = asRecord(value);
  const items = readArray(body, "items") ?? readArray(body, "data");
  if (items?.length) return asRecord(items[0]);
  return body;
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
  const type = normalizeEventType(
    readOptionalString(event, "type") ?? readOptionalString(event, "kind"),
  );
  const base = {
    id: readString(event, "id"),
    conversationId:
      readOptionalString(event, "conversationId") ??
      readOptionalString(event, "conversation_id") ??
      "unknown",
    createdAt:
      readOptionalString(event, "createdAt") ??
      readOptionalString(event, "created_at") ??
      readOptionalString(event, "timestamp") ??
      new Date(0).toISOString(),
  };

  if (type === "agent.message")
    return {
      ...base,
      type,
      message: readOptionalString(event, "message") ?? readOptionalString(event, "content") ?? "",
    };
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

function normalizeEventType(type: string | undefined): OpenHandsEvent["type"] {
  if (type === "agent.message" || type === "message" || type === "MessageEvent")
    return "agent.message";
  if (type === "tool.call" || type === "ActionEvent") return "tool.call";
  if (type === "tool.result" || type === "ObservationEvent") return "tool.result";
  if (type === "run.status") return "run.status";
  throw new Error(`Unsupported OpenHands event type: ${type ?? "<missing>"}`);
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

function parseOpenHandsV1ConversationResult(
  value: unknown,
  fallbackConversationId: string,
): OpenHandsRunResult | undefined {
  const conversation = firstRecord(value);
  if (Object.keys(conversation).length === 0) return undefined;

  const conversationId = readOptionalString(conversation, "id") ?? fallbackConversationId;
  const executionStatus = readOptionalString(conversation, "execution_status");
  const sandboxStatus = readOptionalString(conversation, "sandbox_status");
  if (!executionStatus && !sandboxStatus) return undefined;

  if (sandboxStatus === "ERROR" || sandboxStatus === "MISSING") {
    return {
      conversationId,
      status: "failed",
      summary: `OpenHands sandbox status: ${sandboxStatus}`,
      error: `sandbox_status=${sandboxStatus}`,
    };
  }

  if (executionStatus === "finished") {
    return {
      conversationId,
      status: "completed",
      summary: readOptionalString(conversation, "title") ?? "OpenHands conversation finished.",
    };
  }

  if (executionStatus === "error") {
    return {
      conversationId,
      status: "failed",
      summary: readOptionalString(conversation, "title") ?? "OpenHands conversation failed.",
      error: "execution_status=error",
    };
  }

  if (executionStatus === "stuck" || executionStatus === "waiting_for_confirmation") {
    return {
      conversationId,
      status: "stuck",
      summary:
        executionStatus === "waiting_for_confirmation"
          ? "OpenHands is waiting for confirmation."
          : "OpenHands conversation is stuck.",
      error: `execution_status=${executionStatus}`,
    };
  }

  return undefined;
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
