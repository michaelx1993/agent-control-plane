export interface PlaneClientConfig {
  baseUrl: string;
  apiKey: string;
  fetchFn?: typeof fetch;
}

export class PlaneApiError extends Error {
  readonly status: number;
  readonly statusText: string;
  readonly body: string;
  readonly retryAfterMs: number | undefined;

  constructor(input: { status: number; statusText: string; body: string; retryAfterMs?: number }) {
    super(`Plane API ${input.status} ${input.statusText}: ${input.body}`);
    this.name = "PlaneApiError";
    this.status = input.status;
    this.statusText = input.statusText;
    this.body = input.body;
    this.retryAfterMs = input.retryAfterMs;
  }
}

export interface PlaneLabel {
  id: string;
  name: string;
  color?: string;
}

export interface PlaneState {
  id: string;
  name: string;
}

export interface PlaneWorkItem {
  id: string;
  name: string;
  state: string | null;
  labels?: readonly string[];
  priority?: string | null;
  sequence_id?: number | null;
  updated_at?: string | null;
}

export interface PlaneWorkItemComment {
  id: string;
  comment_html?: string | null;
  comment_stripped?: string | null;
  body?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface PlaneAgentConfigOutboxEvent {
  id: number | string;
  workspace_id?: string;
  entity_type: string;
  entity_id: string;
  operation?: string;
  projection_version: number | string;
  payload: Record<string, unknown>;
  created_at?: string;
}

export interface PlaneListWorkItemsOptions {
  updatedAfter?: string;
}

export interface PlaneListAgentConfigOutboxOptions {
  afterId?: number | string;
  limit?: number;
}

export interface CreatePlaneWorkItemInput {
  name: string;
  descriptionHtml?: string;
  stateId?: string;
  labelIds?: readonly string[];
  priority?: string | null;
}

export interface CreatedPlaneWorkItem {
  id: string;
  name: string;
  state?: string | null;
  labels?: readonly string[];
}

interface PlanePaginatedResponse<T> {
  results?: T[];
}

export class PlaneClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly fetchFn: typeof fetch;

  constructor(config: PlaneClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.apiKey = config.apiKey;
    this.fetchFn = config.fetchFn ?? fetch;
  }

  async listProjectLabels(workspaceSlug: string, projectId: string): Promise<PlaneLabel[]> {
    return this.getCollection<PlaneLabel>(
      `/api/v1/workspaces/${workspaceSlug}/projects/${projectId}/labels/`,
    );
  }

  async listProjectStates(workspaceSlug: string, projectId: string): Promise<PlaneState[]> {
    return this.getCollection<PlaneState>(
      `/api/v1/workspaces/${workspaceSlug}/projects/${projectId}/states/`,
    );
  }

  async listWorkItems(
    workspaceSlug: string,
    projectId: string,
    options: PlaneListWorkItemsOptions = {},
  ): Promise<PlaneWorkItem[]> {
    const searchParams = new URLSearchParams();
    if (options.updatedAfter) {
      searchParams.set("updated_after", options.updatedAfter);
    }
    const encodedSearchParams = searchParams.toString();
    const query = encodedSearchParams ? `?${encodedSearchParams}` : "";

    return this.getCollection<PlaneWorkItem>(
      `/api/v1/workspaces/${workspaceSlug}/projects/${projectId}/issues/${query}`,
    );
  }

  async listWorkItemComments(
    workspaceSlug: string,
    projectId: string,
    workItemId: string,
  ): Promise<PlaneWorkItemComment[]> {
    return this.getCollection<PlaneWorkItemComment>(
      `/api/v1/workspaces/${workspaceSlug}/projects/${projectId}/work-items/${workItemId}/comments/`,
    );
  }

  async listAgentConfigOutbox(
    workspaceSlug: string,
    options: PlaneListAgentConfigOutboxOptions = {},
  ): Promise<PlaneAgentConfigOutboxEvent[]> {
    const searchParams = new URLSearchParams();
    if (options.afterId !== undefined) {
      searchParams.set("after_id", String(options.afterId));
    }
    if (options.limit !== undefined) {
      searchParams.set("limit", String(options.limit));
    }
    const encodedSearchParams = searchParams.toString();
    const query = encodedSearchParams ? `?${encodedSearchParams}` : "";

    return this.getCollection<PlaneAgentConfigOutboxEvent>(
      `/api/v1/workspaces/${workspaceSlug}/agent-config-outbox/${query}`,
    );
  }

  async createWorkItem(
    workspaceSlug: string,
    projectId: string,
    input: CreatePlaneWorkItemInput,
  ): Promise<CreatedPlaneWorkItem> {
    const body: Record<string, unknown> = {
      name: input.name,
    };

    if (input.descriptionHtml) {
      body.description_html = input.descriptionHtml;
    }

    if (input.stateId) {
      body.state = input.stateId;
    }

    if (input.labelIds && input.labelIds.length > 0) {
      body.labels = input.labelIds;
    }

    if (input.priority) {
      body.priority = input.priority;
    }

    return await this.requestJson<CreatedPlaneWorkItem>(
      `/api/v1/workspaces/${workspaceSlug}/projects/${projectId}/issues/`,
      {
        method: "POST",
        body: JSON.stringify(body),
      },
    );
  }

  async updateWorkItemState(
    workspaceSlug: string,
    projectId: string,
    workItemId: string,
    stateId: string,
  ): Promise<void> {
    await this.requestJson<unknown>(
      `/api/v1/workspaces/${workspaceSlug}/projects/${projectId}/work-items/${workItemId}/`,
      {
        method: "PATCH",
        body: JSON.stringify({ state: stateId }),
      },
    );
  }

  async createWorkItemComment(
    workspaceSlug: string,
    projectId: string,
    workItemId: string,
    commentHtml: string,
  ): Promise<void> {
    await this.requestJson<unknown>(
      `/api/v1/workspaces/${workspaceSlug}/projects/${projectId}/work-items/${workItemId}/comments/`,
      {
        method: "POST",
        body: JSON.stringify({
          comment_html: commentHtml,
          external_source: "agent-control-plane",
        }),
      },
    );
  }

  private async getCollection<T>(path: string): Promise<T[]> {
    const json = await this.requestJson<T[] | PlanePaginatedResponse<T>>(path);

    if (Array.isArray(json)) {
      return json;
    }

    if (Array.isArray(json.results)) {
      return json.results;
    }

    throw new Error(`Plane API returned an unsupported collection shape for ${path}`);
  }

  private async requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await this.fetchFn(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": this.apiKey,
        ...init.headers,
      },
    });

    if (!response.ok) {
      const body = await response.text();
      const retryAfterMs = parseRetryAfterMs(response.headers);
      const errorInput: {
        status: number;
        statusText: string;
        body: string;
        retryAfterMs?: number;
      } = {
        status: response.status,
        statusText: response.statusText,
        body,
      };
      if (retryAfterMs !== undefined) {
        errorInput.retryAfterMs = retryAfterMs;
      }
      throw new PlaneApiError(errorInput);
    }

    return (await response.json()) as T;
  }
}

function parseRetryAfterMs(headers: Headers): number | undefined {
  const retryAfter = headers.get("Retry-After");
  if (retryAfter !== null) {
    const retryAfterValue = retryAfter.trim();
    const seconds = Number(retryAfterValue);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.trunc(seconds * 1000);
    }

    const retryAt = new Date(retryAfterValue).getTime();
    if (!Number.isNaN(retryAt)) {
      return Math.max(0, retryAt - Date.now());
    }
  }

  const reset = headers.get("X-RateLimit-Reset");
  if (reset === null) {
    return undefined;
  }

  const resetValue = reset.trim();
  const numericReset = Number(resetValue);
  if (Number.isFinite(numericReset) && numericReset >= 0) {
    const resetMs = numericReset > 10_000_000_000 ? numericReset : numericReset * 1000;
    return Math.max(0, Math.trunc(resetMs - Date.now()));
  }

  const resetAt = new Date(resetValue).getTime();
  return Number.isNaN(resetAt) ? undefined : Math.max(0, resetAt - Date.now());
}
