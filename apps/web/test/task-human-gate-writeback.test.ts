import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  fetchTaskExternalRef: vi.fn(),
  recordTaskFeedback: vi.fn(),
  requestTaskRework: vi.fn(),
  transitionTaskState: vi.fn(),
  withDatabasePool: vi.fn(async (callback: (pool: unknown) => Promise<unknown>) => callback({})),
}));

const plane = vi.hoisted(() => ({
  loadPlaneConfig: vi.fn(() => ({
    baseUrl: "http://plane",
    apiKey: "plane-key",
    workspaceSlug: "workspace",
    projectId: "project",
    projectSlug: "token",
  })),
  writePlaneTaskStateChange: vi.fn(async () => undefined),
}));

vi.mock("@agent-control-plane/db", () => db);
vi.mock("@agent-control-plane/plane", () => plane);

const routeContext = {
  params: Promise.resolve({
    taskId: "task-1",
  }),
};

function jsonRequest(payload: Record<string, unknown>) {
  return new Request("http://control-plane.test", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

describe("human gate Plane writeback routes", () => {
  beforeEach(() => {
    process.env.PLANE_WRITEBACK_ENABLED = "true";
    db.fetchTaskExternalRef.mockReset();
    db.recordTaskFeedback.mockReset();
    db.requestTaskRework.mockReset();
    db.transitionTaskState.mockReset();
    db.withDatabasePool.mockClear();
    plane.loadPlaneConfig.mockClear();
    plane.writePlaneTaskStateChange.mockClear();
  });

  it("writes the target state back to Plane after an operator transition", async () => {
    db.transitionTaskState.mockResolvedValue({
      updated: true,
      taskId: "task-1",
      previousState: "Human Review",
      nextState: "Release Version",
    });
    db.fetchTaskExternalRef.mockResolvedValue({
      externalTaskId: "TOK-1",
      identifier: "TOK-1",
    });

    const route = await import("../app/api/tasks/[taskId]/transition/route");
    const response = await route.POST(
      jsonRequest({
        targetState: "Release Version",
        actor: "魔尊",
        reason: "Human gate approved",
      }),
      routeContext,
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.planeWriteback).toEqual({
      attempted: true,
      ok: true,
    });
    expect(plane.writePlaneTaskStateChange).toHaveBeenCalledWith(
      expect.objectContaining({
        projectSlug: "token",
      }),
      {
        externalTaskId: "TOK-1",
        nextState: "Release Version",
        status: "Human Gate Updated",
        summary: "Human gate approved",
      },
    );
  });

  it("skips Plane writeback when a transition does not update task state", async () => {
    db.transitionTaskState.mockResolvedValue({
      updated: false,
      reason: "invalid_transition",
    });

    const route = await import("../app/api/tasks/[taskId]/transition/route");
    const response = await route.POST(
      jsonRequest({
        targetState: "Done",
      }),
      routeContext,
    );

    expect(response.status).toBe(409);
    expect(db.fetchTaskExternalRef).not.toHaveBeenCalled();
    expect(plane.writePlaneTaskStateChange).not.toHaveBeenCalled();
  });

  it("writes Development back to Plane when direct rework is requested", async () => {
    db.requestTaskRework.mockResolvedValue({
      updated: true,
      taskId: "task-1",
      previousState: "Human Review",
      nextState: "Development",
      feedbackId: "feedback-1",
    });
    db.fetchTaskExternalRef.mockResolvedValue({
      externalTaskId: "TOK-2",
      identifier: "TOK-2",
    });

    const route = await import("../app/api/tasks/[taskId]/rework/route");
    const response = await route.POST(
      jsonRequest({
        body: "补齐移动端落子验收",
        source: "human",
        severity: "major",
      }),
      routeContext,
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.planeWriteback).toEqual({
      attempted: true,
      ok: true,
    });
    expect(plane.writePlaneTaskStateChange).toHaveBeenCalledWith(expect.any(Object), {
      externalTaskId: "TOK-2",
      nextState: "Development",
      status: "Rework Requested",
      summary: "补齐移动端落子验收",
    });
  });

  it("writes Development back to Plane when feedback requests rework", async () => {
    db.requestTaskRework.mockResolvedValue({
      updated: true,
      taskId: "task-1",
      previousState: "Human Review",
      nextState: "Development",
      feedbackId: "feedback-2",
    });
    db.fetchTaskExternalRef.mockResolvedValue({
      externalTaskId: "TOK-3",
      identifier: "TOK-3",
    });

    const route = await import("../app/api/tasks/[taskId]/feedback/route");
    const response = await route.POST(
      jsonRequest({
        body: "Code Review 打回，重新处理胜负判断",
        requestRework: true,
      }),
      routeContext,
    );

    expect(response.status).toBe(200);
    expect(plane.writePlaneTaskStateChange).toHaveBeenCalledWith(expect.any(Object), {
      externalTaskId: "TOK-3",
      nextState: "Development",
      status: "Rework Requested",
      summary: "Code Review 打回，重新处理胜负判断",
    });
  });

  it("does not write to Plane for feedback-only comments", async () => {
    db.recordTaskFeedback.mockResolvedValue({
      inserted: true,
      taskId: "task-1",
      feedbackId: "feedback-3",
    });

    const route = await import("../app/api/tasks/[taskId]/feedback/route");
    const response = await route.POST(
      jsonRequest({
        body: "仅记录验收意见，不打回",
      }),
      routeContext,
    );

    expect(response.status).toBe(200);
    expect(db.requestTaskRework).not.toHaveBeenCalled();
    expect(plane.writePlaneTaskStateChange).not.toHaveBeenCalled();
  });
});
