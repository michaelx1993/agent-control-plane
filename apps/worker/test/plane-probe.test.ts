import { describe, expect, it, vi } from "vitest";

import { runPlaneProbe } from "../src/plane-probe.js";

describe("Plane probe", () => {
  it("fails fast when required Plane configuration is missing", async () => {
    await expect(runPlaneProbe({ env: {} })).resolves.toMatchObject({
      status: "not_ready",
      steps: [
        {
          id: "config",
          status: "fail",
        },
      ],
    });
  });

  it("lists and normalizes repo routing without mutating Plane", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (url, init) => {
      expect(init?.method ?? "GET").toBe("GET");
      if (String(url).endsWith("/labels/")) {
        return jsonResponse({ results: [{ id: "label-repo-crs", name: "repo:crs-src" }] });
      }
      if (String(url).includes("/work-items?per_page=2")) {
        return jsonResponse({
          next_cursor: "page-2",
          results: [
            {
              id: "task-1",
              identifier: "TOK-1",
              name: "Probe me",
              labels: ["label-repo-crs"],
            },
          ],
        });
      }
      if (String(url).endsWith("/work-items/task-1/")) {
        return jsonResponse({
          id: "task-1",
          identifier: "TOK-1",
          name: "Probe me",
          labels: ["label-repo-crs"],
        });
      }
      return jsonResponse({ error: "unexpected" }, 404);
    });

    await expect(
      runPlaneProbe({
        env: {
          PLANE_BASE_URL: "https://plane.test",
          PLANE_API_KEY: "secret",
          PLANE_WORKSPACE_SLUG: "workspace",
          PLANE_PROJECT_ID: "project",
          PLANE_PROBE_PER_PAGE: "2",
        },
        fetch: fetchMock,
        now: () => new Date("2026-06-19T00:00:00.000Z"),
      }),
    ).resolves.toMatchObject({
      status: "ready",
      mutating: false,
      steps: expect.arrayContaining([
        expect.objectContaining({ id: "labels", status: "pass" }),
        expect.objectContaining({ id: "list", status: "pass" }),
        expect.objectContaining({ id: "repo", status: "pass" }),
        expect.objectContaining({ id: "get", status: "pass" }),
        expect.objectContaining({ id: "mutations", status: "skip" }),
      ]),
    });
  });

  it("runs explicit PATCH and comment probes only in mutating mode", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (url, init) => {
      const method = init?.method ?? "GET";
      if (String(url).endsWith("/labels/")) {
        return jsonResponse({ results: [] });
      }
      if (String(url).includes("/work-items?per_page=5")) {
        return jsonResponse({ results: [] });
      }
      if (String(url).endsWith("/work-items/task-1/") && method === "GET") {
        return jsonResponse({
          id: "task-1",
          identifier: "TOK-1",
          name: "Probe me",
          custom_fields: { repo: "traffic" },
        });
      }
      if (String(url).endsWith("/work-items/task-1/") && method === "PATCH") {
        expect(init?.body).toBe(
          JSON.stringify({ labels: ["repo:traffic", "control-plane-probe"] }),
        );
        return jsonResponse({ id: "task-1", name: "Updated" });
      }
      if (String(url).endsWith("/work-items/task-1/comments/") && method === "POST") {
        expect(init?.body).toBe(JSON.stringify({ body: "probe comment" }));
        return jsonResponse({ id: "comment-1", body: "probe comment" }, 201);
      }
      return jsonResponse({ error: "unexpected" }, 404);
    });

    await expect(
      runPlaneProbe({
        env: {
          PLANE_BASE_URL: "https://plane.test",
          PLANE_WORKSPACE_SLUG: "workspace",
          PLANE_PROJECT_ID: "project",
          PLANE_PROBE_TASK_ID: "task-1",
          PLANE_PROBE_MUTATE: "true",
          PLANE_PROBE_PATCH_JSON: JSON.stringify({
            labels: ["repo:traffic", "control-plane-probe"],
          }),
          PLANE_PROBE_COMMENT_BODY: "probe comment",
        },
        fetch: fetchMock,
      }),
    ).resolves.toMatchObject({
      status: "ready",
      mutating: true,
      steps: expect.arrayContaining([
        expect.objectContaining({ id: "patch", status: "pass" }),
        expect.objectContaining({ id: "comment", status: "pass" }),
      ]),
    });
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
