import { describe, expect, it } from "vitest";

import { GET as getPromptReleasesRoute } from "./prompt-releases/route";
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
});
