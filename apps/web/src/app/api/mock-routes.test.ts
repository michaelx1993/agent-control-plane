import { describe, expect, it } from "vitest";

import {
  GET as getPromptComponentsRoute,
  POST as postPromptComponentsRoute,
} from "./prompt-components/route";
import { GET as getPromptReleasesRoute } from "./prompt-releases/route";
import { GET as getRunDetailRoute } from "./runs/[runId]/route";
import { GET as getTasksRoute } from "./tasks/route";

describe("new mock API routes", () => {
  it("returns task queue JSON shaped for a future API client", async () => {
    const response = await getTasksRoute();
    const payload = await response.json();

    expect(payload.count).toBe(payload.tasks.length);
    expect(payload.summary).toMatchObject({
      blocked: expect.any(Number),
      eligible: expect.any(Number),
      failed: expect.any(Number),
      running: expect.any(Number),
    });
    expect(payload.tasks[0]).toMatchObject({
      eligible: expect.any(Boolean),
      id: expect.any(String),
      labels: expect.any(Array),
      lease: expect.any(String),
      planeTask: expect.any(String),
      priority: expect.stringMatching(/^P[0-2]$/),
      project: expect.any(String),
      repo: expect.any(String),
      state: expect.any(String),
    });
  });

  it("returns prompt release JSON with stable run binding fields", async () => {
    const response = await getPromptReleasesRoute();
    const payload = await response.json();

    expect(payload.count).toBe(payload.promptReleases.length);
    expect(payload.promptReleases[0]).toMatchObject({
      changelog: expect.any(String),
      hash: expect.stringMatching(/^sha256:/),
      id: expect.stringMatching(/^prm-/),
      scope: expect.any(String),
      status: expect.stringMatching(/^(active|draft|archived)$/),
      updatedBy: expect.any(String),
      version: expect.any(String),
    });
  });

  it("returns run detail JSON and a 404 for unknown runs", async () => {
    const response = await getRunDetailRoute(new Request("http://localhost/api/runs/run-7741"), {
      params: Promise.resolve({ runId: "run-7741" }),
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.run).toMatchObject({
      id: "run-7741",
      events: expect.any(Array),
      openHandsUrl: expect.stringContaining("/conversations/"),
      traceId: expect.any(String),
    });

    const missingResponse = await getRunDetailRoute(
      new Request("http://localhost/api/runs/missing"),
      {
        params: Promise.resolve({ runId: "missing" }),
      },
    );
    expect(missingResponse.status).toBe(404);
  });

  it("returns an empty prompt component list without a database", async () => {
    const response = await getPromptComponentsRoute();
    const payload = await response.json();

    expect(payload).toEqual({
      count: 0,
      promptComponents: [],
    });
  });

  it("validates prompt component creation payloads", async () => {
    const response = await postPromptComponentsRoute(
      new Request("http://localhost/api/prompt-components", {
        method: "POST",
        body: JSON.stringify({
          scopeType: "invalid",
          name: "global-base",
          content: "Use Chinese.",
        }),
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toContain("scopeType");
  });

  it("requires DATABASE_URL before creating prompt components", async () => {
    const response = await postPromptComponentsRoute(
      new Request("http://localhost/api/prompt-components", {
        method: "POST",
        body: JSON.stringify({
          scopeType: "global",
          name: "global-base",
          content: "Use Chinese.",
        }),
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(503);
    expect(payload.error).toContain("DATABASE_URL");
  });
});
