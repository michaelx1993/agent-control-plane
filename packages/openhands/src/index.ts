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
