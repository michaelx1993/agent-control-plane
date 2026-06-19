export type PlaneLabel = string | { name?: string | null; slug?: string | null };

export type PlaneTaskState = {
  id?: string;
  name?: string;
  group?: string;
};

export type PlaneTaskPayload = {
  id?: string;
  issue_id?: string;
  work_item_id?: string;
  identifier?: string;
  name?: string;
  title?: string;
  description?: string | null;
  state?: string | PlaneTaskState | null;
  team_id?: string;
  project_id?: string;
  repo?: string | null;
  repository?: string | null;
  custom_fields?: Record<string, unknown> | null;
  customFields?: Record<string, unknown> | null;
  labels?: PlaneLabel[];
  url?: string | null;
  html_url?: string | null;
  [key: string]: unknown;
};

export type NormalizedPlaneTask = {
  source: "plane";
  sourceId: string;
  identifier?: string;
  title: string;
  description?: string;
  stateName?: string;
  teamId?: string;
  projectId?: string;
  repo?: string;
  labels: string[];
  url?: string;
  isDispatchable: boolean;
  blockedReason?: string;
  raw: PlaneTaskPayload;
};

export type PlaneWebhookEventType =
  | "task.created"
  | "task.updated"
  | "task.deleted"
  | "comment.created"
  | "state.changed"
  | "unknown";

export type ParsedPlaneWebhook = {
  eventType: PlaneWebhookEventType;
  task?: PlaneTaskPayload;
  raw: Record<string, unknown>;
};

export type ListPlaneTasksParams = {
  workspaceSlug?: string;
  teamId?: string;
  projectId?: string;
  state?: string;
  updatedSince?: string;
  cursor?: string;
  perPage?: number;
};

export type PlaneTaskUpdate = {
  stateId?: string;
  stateName?: string;
  labels?: string[];
  summary?: string;
  [key: string]: unknown;
};

export type PlaneClient = {
  getTask(taskId: string): Promise<PlaneTaskPayload>;
  listTasks(params?: ListPlaneTasksParams): Promise<PlaneTaskPayload[]>;
  updateTask(taskId: string, update: PlaneTaskUpdate): Promise<PlaneTaskPayload>;
  addComment(taskId: string, body: string): Promise<{ id: string; body: string }>;
};

export type HttpPlaneClientOptions = {
  baseUrl: string;
  apiKey?: string;
  workspaceSlug?: string;
  projectId?: string;
  basePath?: string;
  fetch?: typeof fetch;
  defaultHeaders?: Record<string, string>;
};

export class HttpPlaneClient implements PlaneClient {
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly workspaceSlug?: string;
  private readonly projectId?: string;
  private readonly basePath?: string;
  private readonly fetchImpl: typeof fetch;
  private readonly defaultHeaders: Record<string, string>;

  constructor(options: HttpPlaneClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.apiKey = options.apiKey;
    this.workspaceSlug = options.workspaceSlug;
    this.projectId = options.projectId;
    this.basePath = options.basePath?.replace(/\/+$/, "");
    this.fetchImpl = options.fetch ?? fetch;
    this.defaultHeaders = options.defaultHeaders ?? {};
  }

  async getTask(taskId: string): Promise<PlaneTaskPayload> {
    return this.request<PlaneTaskPayload>(`${this.workItemsPath()}/${encodeURIComponent(taskId)}/`);
  }

  async listTasks(params: ListPlaneTasksParams = {}): Promise<PlaneTaskPayload[]> {
    const search = new URLSearchParams();
    if (params.state) search.set("state", params.state);
    if (params.updatedSince) search.set("updated_since", params.updatedSince);
    if (params.cursor) search.set("cursor", params.cursor);
    if (params.perPage) search.set("per_page", String(params.perPage));

    for (const [key, value] of Object.entries(params)) {
      if (
        value &&
        !["workspaceSlug", "projectId", "state", "updatedSince", "cursor", "perPage"].includes(key)
      ) {
        search.set(key, String(value));
      }
    }

    const suffix = search.size > 0 ? `?${search.toString()}` : "";
    const response = await this.request<PlaneTaskPayload[] | { results?: PlaneTaskPayload[] }>(
      `${this.workItemsPath(params)}${suffix}`,
    );

    return Array.isArray(response) ? response : (response.results ?? []);
  }

  async updateTask(taskId: string, update: PlaneTaskUpdate): Promise<PlaneTaskPayload> {
    return this.request<PlaneTaskPayload>(
      `${this.workItemsPath()}/${encodeURIComponent(taskId)}/`,
      {
        method: "PATCH",
        body: JSON.stringify(update),
      },
    );
  }

  async addComment(taskId: string, body: string): Promise<{ id: string; body: string }> {
    return this.request<{ id: string; body: string }>(
      `${this.workItemsPath()}/${encodeURIComponent(taskId)}/comments/`,
      {
        method: "POST",
        body: JSON.stringify({ body }),
      },
    );
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers: Record<string, string> = {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...this.defaultHeaders,
      ...recordFromHeaders(init.headers),
    };

    if (this.apiKey) {
      headers.Authorization = `Bearer ${this.apiKey}`;
    }

    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      ...init,
      headers,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(
        `Plane API request failed: ${response.status} ${response.statusText} ${text}`.trim(),
      );
    }

    return (await response.json()) as T;
  }

  private workItemsPath(params: Pick<ListPlaneTasksParams, "workspaceSlug" | "projectId"> = {}) {
    if (this.basePath) return this.basePath;

    const workspaceSlug = params.workspaceSlug ?? this.workspaceSlug;
    const projectId = params.projectId ?? this.projectId;
    if (!workspaceSlug || !projectId) {
      throw new Error("Plane workspaceSlug and projectId are required for work-items API paths");
    }

    return `/api/v1/workspaces/${encodeURIComponent(workspaceSlug)}/projects/${encodeURIComponent(
      projectId,
    )}/work-items`;
  }
}

export function parsePlaneWebhookPayload(payload: unknown): ParsedPlaneWebhook {
  if (!isRecord(payload)) {
    throw new TypeError("Plane webhook payload must be an object");
  }

  const action =
    stringValue(payload.action) ?? stringValue(payload.event) ?? stringValue(payload.event_type);
  const model =
    stringValue(payload.model) ?? stringValue(payload.entity) ?? stringValue(payload.type);
  const task = extractTaskPayload(payload);

  return {
    eventType: mapWebhookEventType(action, model),
    task,
    raw: payload,
  };
}

export function normalizePlaneTask(task: PlaneTaskPayload): NormalizedPlaneTask {
  const sourceId = task.id ?? task.issue_id ?? task.work_item_id;
  if (!sourceId) {
    throw new Error("Plane task is missing id");
  }

  const labels = normalizeLabels(task.labels);
  const repo = extractRepo(task, labels);
  const title = task.name ?? task.title ?? task.identifier ?? sourceId;
  const stateName = typeof task.state === "string" ? task.state : task.state?.name;
  const blockedReason = repo ? undefined : "missing-repo";

  return {
    source: "plane",
    sourceId,
    identifier: task.identifier,
    title,
    description: task.description ?? undefined,
    stateName,
    teamId: task.team_id,
    projectId: task.project_id,
    repo,
    labels,
    url: task.url ?? task.html_url ?? undefined,
    isDispatchable: !blockedReason,
    blockedReason,
    raw: task,
  };
}

export function parseRepoFromLabels(
  labels: PlaneLabel[] = [],
  prefix = "repo:",
): string | undefined {
  for (const label of normalizeLabels(labels)) {
    if (label.toLowerCase().startsWith(prefix.toLowerCase())) {
      const repo = label.slice(prefix.length).trim();
      if (repo) return repo;
    }
  }

  return undefined;
}

export function extractRepo(
  task: PlaneTaskPayload,
  normalizedLabels = normalizeLabels(task.labels),
): string | undefined {
  const direct = stringValue(task.repo) ?? stringValue(task.repository);
  if (direct) return direct;

  const customFields = {
    ...(task.custom_fields ?? {}),
    ...(task.customFields ?? {}),
  };

  const structured =
    stringValue(customFields.repo) ??
    stringValue(customFields.repository) ??
    stringValue(customFields.repo_name) ??
    stringValue(customFields.repoName);

  return structured ?? parseRepoFromLabels(normalizedLabels);
}

function normalizeLabels(labels: PlaneLabel[] = []): string[] {
  return labels
    .map((label) => {
      if (typeof label === "string") return label;
      return label.name ?? label.slug ?? "";
    })
    .map((label) => label.trim())
    .filter(Boolean);
}

function extractTaskPayload(payload: Record<string, unknown>): PlaneTaskPayload | undefined {
  const candidates = [
    payload.task,
    payload.issue,
    payload.work_item,
    payload.workItem,
    payload.data,
  ];
  for (const candidate of candidates) {
    if (isRecord(candidate)) return candidate as PlaneTaskPayload;
  }

  if (payload.id || payload.issue_id || payload.work_item_id) {
    return payload as PlaneTaskPayload;
  }

  return undefined;
}

function mapWebhookEventType(action?: string, model?: string): PlaneWebhookEventType {
  const normalized = [model, action].filter(Boolean).join(".").toLowerCase();

  if (normalized.includes("comment") && normalized.includes("create")) return "comment.created";
  if (
    normalized.includes("state") &&
    (normalized.includes("change") || normalized.includes("update"))
  ) {
    return "state.changed";
  }
  if (normalized.includes("delete")) return "task.deleted";
  if (normalized.includes("create")) return "task.created";
  if (normalized.includes("update")) return "task.updated";

  return "unknown";
}

function recordFromHeaders(headers?: HeadersInit): Record<string, string> {
  if (!headers) return {};
  if (headers instanceof Headers) {
    const result: Record<string, string> = {};
    headers.forEach((value, key) => {
      result[key] = value;
    });
    return result;
  }
  if (Array.isArray(headers)) return Object.fromEntries(headers);
  return headers;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
