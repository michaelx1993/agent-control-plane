import { describe, expect, it, vi } from "vitest";
import {
  getPlaneProjectSyncCursor,
  resolveRepositoryIdForLabels,
  syncExternalTasks,
  updatePlaneProjectSyncCursor,
} from "../src/task-sync";
import type { DatabaseClient } from "../src/client";

describe("resolveRepositoryIdForLabels", () => {
  it("routes repo labels to active project repositories", () => {
    expect(
      resolveRepositoryIdForLabels(
        ["Feature", "repo:crs-src"],
        [
          { id: "repo-1", slug: "sub3", status: "active" },
          { id: "repo-2", slug: "crs-src", status: "active" },
        ],
      ),
    ).toBe("repo-2");
  });

  it("leaves tasks unrouted when no repo label matches", () => {
    expect(
      resolveRepositoryIdForLabels(
        ["Feature"],
        [{ id: "repo-1", slug: "crs-src", status: "active" }],
      ),
    ).toBeUndefined();
  });
});

describe("syncExternalTasks", () => {
  it("persists estimated cost from cost labels", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ id: "project-1" }] })
      .mockResolvedValueOnce({
        rows: [{ id: "repo-1", slug: "crs-src", status: "active" }],
      })
      .mockResolvedValueOnce({ rows: [] });
    const client = { query } as unknown as DatabaseClient;

    await expect(
      syncExternalTasks(client, {
        projectSlug: "token",
        tasks: [
          {
            externalTaskId: "issue-1",
            identifier: "TOK-1",
            title: "Build",
            state: "Development",
            labels: ["repo:crs-src", "cost:1.25"],
            priority: 2,
          },
        ],
      }),
    ).resolves.toEqual({
      projectId: "project-1",
      upserted: 1,
      routed: 1,
      unrouted: 0,
    });

    expect(query).toHaveBeenLastCalledWith(expect.stringContaining("estimated_cost_usd"), [
      "project-1",
      "repo-1",
      "issue-1",
      "TOK-1",
      "Build",
      "Development",
      2,
      1.25,
      JSON.stringify(["repo:crs-src", "cost:1.25"]),
      null,
      null,
    ]);
  });
});

describe("plane project sync cursor", () => {
  it("loads the cursor from app_settings", async () => {
    const client = {
      query: vi.fn().mockResolvedValue({
        rows: [{ value: "2026-06-19T12:00:00.000Z" }],
      }),
    } as unknown as DatabaseClient;

    await expect(getPlaneProjectSyncCursor(client, "token")).resolves.toBe(
      "2026-06-19T12:00:00.000Z",
    );
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining("from app_settings"), [
      "plane.sync_cursor.token",
    ]);
  });

  it("persists the cursor in app_settings", async () => {
    const client = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
    } as unknown as DatabaseClient;

    await updatePlaneProjectSyncCursor(client, {
      projectSlug: "token",
      syncCursor: "2026-06-19T12:10:00.000Z",
    });

    expect(client.query).toHaveBeenCalledWith(expect.stringContaining("insert into app_settings"), [
      "plane.sync_cursor.token",
      "2026-06-19T12:10:00.000Z",
      "Plane polling sync cursor for project token.",
    ]);
  });
});
