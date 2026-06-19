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
  it("sends bearer auth and JSON updates through fetch", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ id: "task-1", name: "Updated" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const client = new HttpPlaneClient({
      baseUrl: "https://plane.example",
      apiKey: "secret",
      fetch: fetchMock,
    });

    const task = await client.updateTask("task-1", { stateName: "Development" });

    expect(task.name).toBe("Updated");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://plane.example/api/tasks/task-1",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ stateName: "Development" }),
        headers: expect.objectContaining({ Authorization: "Bearer secret" }),
      }),
    );
  });
});
