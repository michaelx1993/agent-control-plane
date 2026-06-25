import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  previewPlaneRuntimeForTask: vi.fn(),
  withDatabasePool: vi.fn(async (callback: (pool: unknown) => Promise<unknown>) => callback({})),
}));

vi.mock("@agent-control-plane/db", () => db);

const taskPageSource = readFileSync(
  new URL("../app/tasks/[taskId]/page.tsx", import.meta.url),
  "utf8",
);

const routeContext = {
  params: Promise.resolve({
    taskId: "task-1",
  }),
};

describe("task run preview", () => {
  beforeEach(() => {
    db.previewPlaneRuntimeForTask.mockReset();
    db.withDatabasePool.mockClear();
  });

  it("renders Run Preview prompt and secret-key metadata on task detail", () => {
    expect(taskPageSource).toContain("<h2>Run Preview</h2>");
    expect(taskPageSource).toContain("<h3>Prompt stack</h3>");
    expect(taskPageSource).toContain("<h3>Secret keys</h3>");
    expect(taskPageSource).toContain("<h3>Assembled prompt preview</h3>");
    expect(taskPageSource).toContain("previewPlaneRuntimeForTask(pool, { taskId })");
    expect(taskPageSource).toContain("runPreview.payload.availableSecretKeys");
  });

  it("returns a runtime preview for API consumers", async () => {
    db.previewPlaneRuntimeForTask.mockResolvedValue({
      snapshotHash: "hash-1",
      createdAt: new Date("2026-06-25T00:00:00.000Z"),
      payload: {
        schemaVersion: "plane-runtime-snapshot.v1",
        run: { id: "preview:task-1" },
        task: { identifier: "ACP-1" },
        project: {},
        repository: {},
        role: { key: "development" },
        agent: { name: "Codex Developer" },
        worker: { workerId: "mac-studio-worker-1" },
        prompts: [],
        assembledPrompt: "",
        availableSecretKeys: ["GITHUB_TOKEN"],
      },
    });

    const route = await import("../app/api/tasks/[taskId]/run-preview/route");
    const response = await route.GET(
      new Request("http://control-plane.test/api/tasks/task-1/run-preview?workerId=worker-2"),
      routeContext,
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.preview.snapshotHash).toBe("hash-1");
    expect(payload.preview.payload.availableSecretKeys).toEqual(["GITHUB_TOKEN"]);
    expect(db.previewPlaneRuntimeForTask).toHaveBeenCalledWith(expect.any(Object), {
      taskId: "task-1",
      workerId: "worker-2",
    });
  });

  it("returns 404 when preview is unavailable", async () => {
    db.previewPlaneRuntimeForTask.mockResolvedValue(undefined);

    const route = await import("../app/api/tasks/[taskId]/run-preview/route");
    const response = await route.GET(
      new Request("http://control-plane.test/api/tasks/task-1/run-preview"),
      routeContext,
    );
    const payload = await response.json();

    expect(response.status).toBe(404);
    expect(payload.error).toContain("unavailable");
  });
});
