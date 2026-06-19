import { describe, expect, it, vi } from "vitest";

import { runLivePreflight } from "../src/live-preflight.js";

describe("runLivePreflight", () => {
  const databaseBaseline = [{ teams: 1, repositories: 3, roles: 6, agents: 6 }];

  it("reports missing live integration environment without throwing", async () => {
    const report = await runLivePreflight({
      env: {},
      fetch: vi.fn<typeof fetch>(),
    });

    expect(report.status).toBe("not_ready");
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "env:PLANE_BASE_URL",
          status: "fail",
        }),
        expect.objectContaining({
          id: "database",
          status: "skip",
        }),
        expect.objectContaining({
          id: "plane",
          status: "skip",
        }),
      ]),
    );
  });

  it("passes when database, Plane, OpenHands, and Langfuse probes respond", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/work-items?per_page=1")) {
        return jsonResponse({ results: [{ id: "plane-1", name: "Live task" }] });
      }
      if (url === "https://openhands.example/health") {
        return jsonResponse({ status: "ok" });
      }
      if (url === "https://langfuse.example/api/public/health") {
        return jsonResponse({ status: "ok" });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    const db = {
      $queryRawUnsafe: vi
        .fn()
        .mockResolvedValueOnce([{ "?column?": 1 }])
        .mockResolvedValueOnce(databaseBaseline),
      $disconnect: vi.fn().mockResolvedValue(undefined),
    };

    const report = await runLivePreflight({
      env: {
        DATABASE_URL: "postgresql://agent:agent@localhost:54329/agent_control_plane",
        PLANE_BASE_URL: "https://plane.example",
        PLANE_WORKSPACE_SLUG: "workspace",
        PLANE_PROJECT_ID: "project",
        PLANE_API_KEY: "plane-key",
        OPENHANDS_BASE_URL: "https://openhands.example",
        LANGFUSE_BASE_URL: "https://langfuse.example",
        LANGFUSE_PUBLIC_KEY: "pk",
        LANGFUSE_SECRET_KEY: "sk",
      },
      fetch: fetchMock,
      db,
    });

    expect(report.status).toBe("ready");
    expect(report.checks.every((check) => check.status === "pass")).toBe(true);
    expect(db.$queryRawUnsafe).toHaveBeenCalledWith("SELECT 1");
    expect(db.$queryRawUnsafe).toHaveBeenCalledWith(expect.stringContaining("FROM teams"));
    expect(fetchMock).toHaveBeenCalledWith(
      "https://plane.example/api/v1/workspaces/workspace/projects/project/work-items?per_page=1",
      expect.objectContaining({
        headers: expect.objectContaining({
          "X-API-Key": "plane-key",
        }),
      }),
    );
  });

  it("supports Authorization bearer auth for Plane when configured", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/work-items?per_page=1")) {
        return jsonResponse({ results: [] });
      }
      if (url === "https://openhands.example/health") {
        return jsonResponse({ status: "ok" });
      }
      if (url === "https://langfuse.example/api/public/health") {
        return jsonResponse({ status: "ok" });
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    await runLivePreflight({
      env: {
        DATABASE_URL: "postgresql://agent:agent@localhost:54329/agent_control_plane",
        PLANE_BASE_URL: "https://plane.example",
        PLANE_WORKSPACE_SLUG: "workspace",
        PLANE_PROJECT_ID: "project",
        PLANE_API_KEY: "plane-key",
        PLANE_API_KEY_HEADER: "Authorization",
        OPENHANDS_BASE_URL: "https://openhands.example",
        LANGFUSE_BASE_URL: "https://langfuse.example",
        LANGFUSE_PUBLIC_KEY: "pk",
        LANGFUSE_SECRET_KEY: "sk",
      },
      fetch: fetchMock,
      db: {
        $queryRawUnsafe: vi
          .fn()
          .mockResolvedValueOnce([{ "?column?": 1 }])
          .mockResolvedValueOnce(databaseBaseline),
      },
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://plane.example/api/v1/workspaces/workspace/projects/project/work-items?per_page=1",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer plane-key",
        }),
      }),
    );
  });

  it("marks a live dependency failed when its probe returns non-2xx", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/work-items?per_page=1")) {
        return jsonResponse({ results: [] });
      }
      if (url === "https://openhands.example/health") {
        return {
          ok: false,
          status: 503,
          statusText: "Service Unavailable",
        } as Response;
      }
      if (url === "https://langfuse.example/api/public/health") {
        return jsonResponse({ status: "ok" });
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    const report = await runLivePreflight({
      env: {
        DATABASE_URL: "postgresql://agent:agent@localhost:54329/agent_control_plane",
        PLANE_BASE_URL: "https://plane.example",
        PLANE_WORKSPACE_SLUG: "workspace",
        PLANE_PROJECT_ID: "project",
        OPENHANDS_BASE_URL: "https://openhands.example",
        LANGFUSE_BASE_URL: "https://langfuse.example",
        LANGFUSE_PUBLIC_KEY: "pk",
        LANGFUSE_SECRET_KEY: "sk",
      },
      fetch: fetchMock,
      db: {
        $queryRawUnsafe: vi
          .fn()
          .mockResolvedValueOnce([{ "?column?": 1 }])
          .mockResolvedValueOnce(databaseBaseline),
      },
    });

    expect(report.status).toBe("not_ready");
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        id: "openhands",
        status: "fail",
        detail: expect.stringContaining("503"),
      }),
    );
  });

  it("fails when Control Plane baseline rows are missing", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/work-items?per_page=1")) {
        return jsonResponse({ results: [] });
      }
      if (url === "https://openhands.example/health") {
        return jsonResponse({ status: "ok" });
      }
      if (url === "https://langfuse.example/api/public/health") {
        return jsonResponse({ status: "ok" });
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    const report = await runLivePreflight({
      env: {
        DATABASE_URL: "postgresql://agent:agent@localhost:54329/agent_control_plane",
        PLANE_BASE_URL: "https://plane.example",
        PLANE_WORKSPACE_SLUG: "workspace",
        PLANE_PROJECT_ID: "project",
        OPENHANDS_BASE_URL: "https://openhands.example",
        LANGFUSE_BASE_URL: "https://langfuse.example",
        LANGFUSE_PUBLIC_KEY: "pk",
        LANGFUSE_SECRET_KEY: "sk",
      },
      fetch: fetchMock,
      db: {
        $queryRawUnsafe: vi
          .fn()
          .mockResolvedValueOnce([{ "?column?": 1 }])
          .mockResolvedValueOnce([{ teams: 1, repositories: 0, roles: 6, agents: 0 }]),
      },
    });

    expect(report.status).toBe("not_ready");
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        id: "database",
        status: "fail",
        detail: expect.stringContaining("baseline is incomplete"),
      }),
    );
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        id: "database",
        detail: expect.stringContaining("repositories=0"),
      }),
    );
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        id: "database",
        detail: expect.stringContaining("agents=0"),
      }),
    );
  });
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
