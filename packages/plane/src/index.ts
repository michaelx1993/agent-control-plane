export type PlaneLabel =
  | string
  | { id?: string | null; name?: string | null; slug?: string | null };

export type PlaneProjectLabelPayload = {
  id?: string;
  name?: string | null;
  slug?: string | null;
  [key: string]: unknown;
};

export type PlaneLabelResolver = (label: PlaneLabel) => PlaneLabel | string | undefined;

export type NormalizePlaneTaskOptions = {
  labelResolver?: PlaneLabelResolver;
};

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
  priority?: string | number | null;
  assignee?: string | { name?: string | null; email?: string | null } | null;
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
  priority?: number;
  assignee?: string;
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

export type ListPlaneLabelsParams = {
  workspaceSlug?: string;
  projectId?: string;
};

export type PlaneTaskListPage = {
  results: PlaneTaskPayload[];
  nextCursor?: string;
};

export type PlaneTaskUpdate = {
  stateId?: string;
  stateName?: string;
  labels?: string[];
  summary?: string;
  [key: string]: unknown;
};

export type PlaneTaskCreate = {
  name: string;
  description?: string;
  stateName?: string;
  labels?: string[];
  priority?: string;
  custom_fields?: Record<string, unknown>;
  [key: string]: unknown;
};

export type PlaneClient = {
  getTask(taskId: string): Promise<PlaneTaskPayload>;
  listTasks(params?: ListPlaneTasksParams): Promise<PlaneTaskPayload[]>;
  listTaskPage(params?: ListPlaneTasksParams): Promise<PlaneTaskListPage>;
  listLabels?(params?: ListPlaneLabelsParams): Promise<PlaneProjectLabelPayload[]>;
  createTask(input: PlaneTaskCreate): Promise<PlaneTaskPayload>;
  updateTask(taskId: string, update: PlaneTaskUpdate): Promise<PlaneTaskPayload>;
  addComment(taskId: string, body: string): Promise<{ id: string; body: string }>;
};

export type LinearIssuePayload = {
  id?: string;
  issueId?: string;
  identifier?: string;
  key?: string;
  number?: string | number;
  title?: string;
  name?: string;
  description?: string | null;
  state?: string | { name?: string | null } | null;
  status?: string | null;
  priority?: string | number | null;
  labels?: Array<string | { name?: string | null }>;
  labelNames?: string[];
  project?: string | { name?: string | null; id?: string | null } | null;
  team?: string | { name?: string | null; id?: string | null } | null;
  assignee?: string | { name?: string | null; email?: string | null } | null;
  url?: string | null;
  repo?: string | null;
  repository?: string | null;
  [key: string]: unknown;
};

export type PlaneImportDraft = {
  source: "linear";
  sourceId: string;
  identifier: string;
  title: string;
  description: string;
  stateName: string;
  priority?: string;
  labels: string[];
  repo?: string;
  blockedReason?: "missing-repo";
  sourceUrl?: string;
  metadata: Record<string, unknown>;
};

export type HttpPlaneClientOptions = {
  baseUrl: string;
  apiKey?: string;
  apiKeyHeader?: string;
  workspaceSlug?: string;
  projectId?: string;
  basePath?: string;
  fetch?: typeof fetch;
  defaultHeaders?: Record<string, string>;
};

export class HttpPlaneClient implements PlaneClient {
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly apiKeyHeader: string;
  private readonly workspaceSlug?: string;
  private readonly projectId?: string;
  private readonly basePath?: string;
  private readonly fetchImpl: typeof fetch;
  private readonly defaultHeaders: Record<string, string>;

  constructor(options: HttpPlaneClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.apiKey = options.apiKey;
    this.apiKeyHeader = options.apiKeyHeader ?? "X-API-Key";
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
    const firstPage = await this.listTaskPage(params);
    return firstPage.results;
  }

  async listTaskPage(params: ListPlaneTasksParams = {}): Promise<PlaneTaskListPage> {
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
    const response = await this.request<
      | PlaneTaskPayload[]
      | {
          next_cursor?: string | null;
          nextCursor?: string | null;
          results?: PlaneTaskPayload[];
        }
    >(`${this.workItemsPath(params)}${suffix}`);

    return Array.isArray(response)
      ? { results: response }
      : {
          nextCursor: response.next_cursor ?? response.nextCursor ?? undefined,
          results: response.results ?? [],
        };
  }

  async createTask(input: PlaneTaskCreate): Promise<PlaneTaskPayload> {
    return this.request<PlaneTaskPayload>(this.workItemsPath(), {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  async listLabels(params: ListPlaneLabelsParams = {}): Promise<PlaneProjectLabelPayload[]> {
    const response = await this.request<
      PlaneProjectLabelPayload[] | { results?: PlaneProjectLabelPayload[] }
    >(this.labelsPath(params));

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
      headers[this.apiKeyHeader] =
        this.apiKeyHeader.toLowerCase() === "authorization" ? `Bearer ${this.apiKey}` : this.apiKey;
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

  private labelsPath(params: ListPlaneLabelsParams = {}) {
    const workspaceSlug = params.workspaceSlug ?? this.workspaceSlug;
    const projectId = params.projectId ?? this.projectId;
    if (!workspaceSlug || !projectId) {
      throw new Error("Plane workspaceSlug and projectId are required for labels API paths");
    }

    return `/api/v1/workspaces/${encodeURIComponent(workspaceSlug)}/projects/${encodeURIComponent(
      projectId,
    )}/labels/`;
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

export function normalizePlaneTask(
  task: PlaneTaskPayload,
  options: NormalizePlaneTaskOptions = {},
): NormalizedPlaneTask {
  const sourceId = task.id ?? task.issue_id ?? task.work_item_id;
  if (!sourceId) {
    throw new Error("Plane task is missing id");
  }

  const labels = normalizeLabels(task.labels, options.labelResolver);
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
    priority: normalizePlanePriority(task.priority),
    assignee: stringValue(task.assignee) ?? recordName(task.assignee),
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

export function createPlaneLabelResolver(
  labels: PlaneProjectLabelPayload[] = [],
): PlaneLabelResolver {
  const labelByKey = new Map<string, string>();
  for (const label of labels) {
    const resolved = stringValue(label.name) ?? stringValue(label.slug);
    if (!resolved) continue;

    for (const key of [label.id, label.slug, label.name]) {
      const normalizedKey = stringValue(key);
      if (normalizedKey) {
        labelByKey.set(normalizedKey, resolved);
      }
    }
  }

  return (label) => {
    const key =
      typeof label === "string"
        ? stringValue(label)
        : (stringValue(label.id) ?? stringValue(label.slug) ?? stringValue(label.name));
    if (!key) return label;
    return labelByKey.get(key) ?? label;
  };
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

function normalizePlanePriority(priority: PlaneTaskPayload["priority"]): number | undefined {
  if (priority === undefined || priority === null) return undefined;
  if (typeof priority === "number" && Number.isFinite(priority)) return Math.max(0, priority);

  const normalized = String(priority).trim().toLowerCase();
  const pMatch = /^p(?<level>[0-9]+)$/.exec(normalized);
  if (pMatch?.groups?.level) return Number(pMatch.groups.level);

  const numeric = Number(normalized);
  if (Number.isFinite(numeric)) return Math.max(0, numeric);

  const priorityMap: Record<string, number> = {
    urgent: 0,
    critical: 0,
    high: 0,
    medium: 1,
    normal: 1,
    low: 2,
    none: 2,
  };

  return priorityMap[normalized];
}

export function linearIssueToPlaneImportDraft(issue: LinearIssuePayload): PlaneImportDraft {
  const sourceId = stringValue(issue.id) ?? stringValue(issue.issueId) ?? issueIdentifier(issue);
  if (!sourceId) {
    throw new Error("Linear issue is missing id or identifier");
  }

  const identifier = issueIdentifier(issue) ?? sourceId;
  const labels = normalizeLinearLabels(issue);
  const repo =
    stringValue(issue.repo) ?? stringValue(issue.repository) ?? repoFromGenericLabels(labels);
  const title = stringValue(issue.title) ?? stringValue(issue.name) ?? identifier;
  const sourceUrl = stringValue(issue.url);
  const description = [
    issue.description ?? "",
    "",
    "----",
    `Migrated from Linear: ${identifier}`,
    sourceUrl ? `Source: ${sourceUrl}` : undefined,
  ]
    .filter((line) => line !== undefined)
    .join("\n")
    .trim();

  return {
    source: "linear",
    sourceId,
    identifier,
    title,
    description,
    stateName: linearStateName(issue),
    priority:
      issue.priority === undefined || issue.priority === null ? undefined : String(issue.priority),
    labels:
      repo && !labels.some((label) => label.toLowerCase() === `repo:${repo}`.toLowerCase())
        ? [...labels, `repo:${repo}`]
        : labels,
    repo,
    blockedReason: repo ? undefined : "missing-repo",
    sourceUrl,
    metadata: {
      assignee: stringValue(issue.assignee) ?? recordName(issue.assignee),
      project: stringValue(issue.project) ?? recordName(issue.project),
      team: stringValue(issue.team) ?? recordName(issue.team),
    },
  };
}

export function linearExportToPlaneImportDrafts(input: unknown): PlaneImportDraft[] {
  const issues = extractLinearIssues(input);
  return issues.map((issue) => linearIssueToPlaneImportDraft(issue));
}

export function planeImportDraftToCreatePayload(draft: PlaneImportDraft): PlaneTaskCreate {
  if (draft.blockedReason) {
    throw new Error(`Cannot create Plane task for ${draft.identifier}: ${draft.blockedReason}`);
  }

  return {
    name: draft.title,
    description: draft.description,
    stateName: draft.stateName,
    labels: draft.labels,
    priority: draft.priority,
    custom_fields: {
      repo: draft.repo,
      source: draft.source,
      sourceId: draft.sourceId,
      sourceIdentifier: draft.identifier,
      sourceUrl: draft.sourceUrl,
      ...draft.metadata,
    },
  };
}

function normalizeLabels(labels: PlaneLabel[] = [], resolver?: PlaneLabelResolver): string[] {
  return labels
    .map((label) => {
      const resolved = resolver?.(label) ?? label;
      if (typeof resolved === "string") return resolved;
      return resolved.name ?? resolved.slug ?? "";
    })
    .map((label) => label.trim())
    .filter(Boolean);
}

function normalizeLinearLabels(issue: LinearIssuePayload): string[] {
  const labels = [...(issue.labels ?? []), ...(issue.labelNames ?? [])];
  return labels
    .map((label) => {
      if (typeof label === "string") return label;
      return label.name ?? "";
    })
    .map((label) => label.trim())
    .filter(Boolean);
}

function repoFromGenericLabels(labels: string[]): string | undefined {
  return parseRepoFromLabels(labels);
}

function issueIdentifier(issue: LinearIssuePayload): string | undefined {
  return (
    stringValue(issue.identifier) ??
    stringValue(issue.key) ??
    (issue.number === undefined ? undefined : String(issue.number))
  );
}

function linearStateName(issue: LinearIssuePayload): string {
  const state =
    typeof issue.state === "string"
      ? issue.state
      : (issue.state?.name ?? stringValue(issue.status) ?? "Todo");
  return state.trim() || "Todo";
}

function recordName(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  return stringValue(value.name) ?? stringValue(value.email) ?? stringValue(value.id);
}

function extractLinearIssues(input: unknown): LinearIssuePayload[] {
  if (Array.isArray(input)) return input.filter(isRecord) as LinearIssuePayload[];
  if (!isRecord(input)) {
    throw new TypeError("Linear export must be an array or object");
  }

  const candidates = [input.issues, input.data, input.results, input.nodes];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate.filter(isRecord) as LinearIssuePayload[];
    }
  }

  throw new Error("Linear export does not contain issues, data, results, or nodes array");
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
