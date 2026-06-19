import { describe, expect, it, vi } from "vitest";
import {
  HttpPlaneClient,
  normalizePlaneTask,
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
