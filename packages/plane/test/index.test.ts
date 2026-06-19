import { describe, expect, it, vi } from "vitest";
import {
  HttpPlaneClient,
  linearExportToPlaneImportDrafts,
  linearIssueToPlaneImportDraft,
  normalizePlaneTask,
  planeImportDraftToCreatePayload,
  parsePlaneWebhookPayload,
  parseRepoFromLabels,
} from "../src/index.js";

describe("repo parsing", () => {
  it("prefers structured repo fields over label fallback", () => {
    const task = normalizePlaneTask({
      id: "task-1",
      name: "Implement queue",
      custom_fields: { repo: "crs-src" },
      labels: ["repo:traffic"],
    });

    expect(task.repo).toBe("crs-src");
    expect(task.isDispatchable).toBe(true);
  });

  it("falls back to repo labels", () => {
    expect(parseRepoFromLabels([{ name: "repo:sub3" }, "blocked"])).toBe("sub3");
  });

  it("blocks dispatch when repo is missing", () => {
    const task = normalizePlaneTask({ id: "task-2", name: "No repo" });

    expect(task.isDispatchable).toBe(false);
    expect(task.blockedReason).toBe("missing-repo");
  });
});

describe("webhook parser", () => {
  it("extracts common Plane issue update payloads", () => {
    const parsed = parsePlaneWebhookPayload({
      action: "updated",
      model: "issue",
      issue: { id: "issue-1", name: "Webhook task", labels: ["repo:traffic"] },
    });

    expect(parsed.eventType).toBe("task.updated");
    expect(parsed.task?.id).toBe("issue-1");
  });
});

describe("Linear migration draft", () => {
  it("converts Linear issues into Plane import drafts with repo labels", () => {
    const draft = linearIssueToPlaneImportDraft({
      id: "lin-1",
      identifier: "TOK-3",
      title: "Build traffic ingestion",
      description: "Move task execution to Plane.",
      state: { name: "Development" },
      priority: "High",
      labels: [{ name: "repo:traffic" }, { name: "Feature" }],
      assignee: { name: "bob-x" },
      project: { name: "token" },
      team: { name: "token-team" },
      url: "https://linear.app/workspace/issue/TOK-3",
    });

    expect(draft).toMatchObject({
      blockedReason: undefined,
      identifier: "TOK-3",
      repo: "traffic",
      source: "linear",
      sourceId: "lin-1",
      stateName: "Development",
      title: "Build traffic ingestion",
    });
    expect(draft.labels).toContain("repo:traffic");
    expect(draft.description).toContain("Migrated from Linear: TOK-3");
    expect(draft.metadata).toMatchObject({
      assignee: "bob-x",
      project: "token",
      team: "token-team",
    });
  });

  it("marks missing repo drafts as blocked for manual routing", () => {
    const draft = linearIssueToPlaneImportDraft({
      id: "lin-2",
      key: "TOK-4",
      title: "No repo yet",
      status: "Todo",
    });

    expect(draft.blockedReason).toBe("missing-repo");
    expect(draft.repo).toBeUndefined();
  });

  it("accepts common Linear export wrappers", () => {
    const drafts = linearExportToPlaneImportDrafts({
      issues: [
        {
          id: "lin-3",
          identifier: "TOK-5",
          title: "Wrapped issue",
          repo: "crs-src",
        },
      ],
    });

    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({
      identifier: "TOK-5",
      repo: "crs-src",
    });
  });

  it("builds Plane create payloads and refuses blocked drafts", () => {
    const draft = linearIssueToPlaneImportDraft({
      id: "lin-4",
      identifier: "TOK-6",
      title: "Ready issue",
      repo: "traffic",
    });
    const payload = planeImportDraftToCreatePayload(draft);

    expect(payload).toMatchObject({
      name: "Ready issue",
      custom_fields: {
        repo: "traffic",
        source: "linear",
        sourceIdentifier: "TOK-6",
      },
    });

    expect(() =>
      planeImportDraftToCreatePayload(
        linearIssueToPlaneImportDraft({ id: "lin-5", identifier: "TOK-7", title: "Blocked" }),
      ),
    ).toThrow("missing-repo");
  });
});

describe("HTTP client skeleton", () => {
  it("sends Plane API key auth and JSON updates through fetch", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ id: "task-1", name: "Updated" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const client = new HttpPlaneClient({
      baseUrl: "https://plane.example",
      apiKey: "secret",
      workspaceSlug: "bob-x-space",
      projectId: "token",
      fetch: fetchMock,
    });

    const task = await client.updateTask("task-1", { stateName: "Development" });

    expect(task.name).toBe("Updated");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://plane.example/api/v1/workspaces/bob-x-space/projects/token/work-items/task-1/",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ stateName: "Development" }),
        headers: expect.objectContaining({ "X-API-Key": "secret" }),
      }),
    );
  });

  it("creates Plane work items with POST", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ id: "task-2", name: "Created" }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const client = new HttpPlaneClient({
      baseUrl: "https://plane.example",
      apiKey: "secret",
      workspaceSlug: "bob-x-space",
      projectId: "token",
      fetch: fetchMock,
    });

    const task = await client.createTask({ name: "Created", labels: ["repo:traffic"] });

    expect(task.name).toBe("Created");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://plane.example/api/v1/workspaces/bob-x-space/projects/token/work-items",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ name: "Created", labels: ["repo:traffic"] }),
        headers: expect.objectContaining({ "X-API-Key": "secret" }),
      }),
    );
  });

  it("can use Authorization bearer auth when explicitly configured", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ results: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const client = new HttpPlaneClient({
      baseUrl: "https://plane.example",
      apiKey: "secret",
      apiKeyHeader: "Authorization",
      workspaceSlug: "bob-x-space",
      projectId: "token",
      fetch: fetchMock,
    });

    await client.listTasks({ perPage: 1 });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://plane.example/api/v1/workspaces/bob-x-space/projects/token/work-items?per_page=1",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer secret" }),
      }),
    );
  });

  it("builds official work-items list paths with pagination params", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ results: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const client = new HttpPlaneClient({
      baseUrl: "https://plane.example",
      apiKey: "secret",
      workspaceSlug: "bob-x-space",
      projectId: "token",
      fetch: fetchMock,
    });

    await client.listTasks({ perPage: 20, cursor: "20:1:0", state: "Development" });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://plane.example/api/v1/workspaces/bob-x-space/projects/token/work-items?state=Development&cursor=20%3A1%3A0&per_page=20",
      expect.any(Object),
    );
  });

  it("requires workspace and project unless basePath is supplied", async () => {
    const client = new HttpPlaneClient({
      baseUrl: "https://plane.example",
      apiKey: "secret",
      fetch: vi.fn<typeof fetch>(),
    });

    await expect(client.listTasks()).rejects.toThrow("workspaceSlug and projectId are required");
  });
});
