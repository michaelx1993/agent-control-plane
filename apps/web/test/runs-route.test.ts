import { describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  upsertPlaneRunIntentTask: vi.fn(),
  withDatabasePool: vi.fn(async (callback: (pool: unknown) => Promise<unknown>) =>
    callback({ pool: true }),
  ),
  withTransaction: vi.fn(async (_pool: unknown, callback: (client: unknown) => Promise<unknown>) =>
    callback({ transaction: true }),
  ),
}));

vi.mock("@agent-control-plane/db", () => db);

function jsonRequest(payload: Record<string, unknown>): Request {
  return new Request("http://control-plane.test/api/runs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

describe("runs route", () => {
  it("queues Plane run intents as dispatchable tasks", async () => {
    db.upsertPlaneRunIntentTask.mockResolvedValueOnce({
      taskId: "task-1",
      projectId: "project-1",
      externalTaskId: "plane-issue-1",
      identifier: "CODEX-1",
      repositoryId: "repo-1",
      repositorySlug: "crs-src",
      routed: true,
    });
    const route = await import("../app/api/runs/route");

    const response = await route.POST(
      jsonRequest({
        source: "plane",
        planeProjectId: "plane-project-1",
        externalTaskId: "plane-issue-1",
        identifier: "CODEX-1",
        title: "Build from Plane",
        state: "Development",
        labels: ["agent"],
        repositoryKey: "crs-src",
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      ok: true,
      queued: true,
      task: {
        taskId: "task-1",
        projectId: "project-1",
        externalTaskId: "plane-issue-1",
        identifier: "CODEX-1",
        repositoryId: "repo-1",
        repositorySlug: "crs-src",
        routed: true,
      },
    });
    expect(db.upsertPlaneRunIntentTask).toHaveBeenCalledWith(
      { transaction: true },
      expect.objectContaining({
        planeProjectId: "plane-project-1",
        externalTaskId: "plane-issue-1",
        identifier: "CODEX-1",
        state: "Development",
        repositoryKey: "crs-src",
      }),
    );
  });

  it("rejects non-Plane run intent sources", async () => {
    const route = await import("../app/api/runs/route");

    const response = await route.POST(jsonRequest({ source: "manual" }));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe("source must be plane.");
  });
});
