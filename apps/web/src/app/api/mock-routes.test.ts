import { describe, expect, it } from "vitest";

import {
  GET as getPromptBindingsRoute,
  POST as postPromptBindingsRoute,
} from "./prompt-bindings/route";
import { POST as postPlaneWebhookRoute } from "./plane/webhook/route";
import {
  GET as getPromptComponentsRoute,
  POST as postPromptComponentsRoute,
} from "./prompt-components/route";
import { GET as getPromptReleasesRoute } from "./prompt-releases/route";
import { GET as getPromptScopesRoute } from "./prompt-scopes/route";
import { GET as getRunDetailRoute } from "./runs/[runId]/route";
import { POST as postRunFeedbackRoute } from "./runs/[runId]/feedback/route";
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

  it("validates run feedback creation payloads", async () => {
    const response = await postRunFeedbackRoute(
      new Request("http://localhost/api/runs/run-1/feedback", {
        method: "POST",
        body: JSON.stringify({
          severity: "major",
        }),
      }),
      { params: Promise.resolve({ runId: "run-1" }) },
    );
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toContain("body");
  });

  it("requires DATABASE_URL before creating run feedback", async () => {
    const response = await postRunFeedbackRoute(
      new Request("http://localhost/api/runs/run-1/feedback", {
        method: "POST",
        body: JSON.stringify({
          body: "Please fix the review feedback.",
          returnToDevelopment: true,
        }),
      }),
      { params: Promise.resolve({ runId: "run-1" }) },
    );
    const payload = await response.json();

    expect(response.status).toBe(503);
    expect(payload.error).toContain("DATABASE_URL");
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

  it("returns an empty prompt binding list without a database", async () => {
    const response = await getPromptBindingsRoute();
    const payload = await response.json();

    expect(payload).toEqual({
      count: 0,
      promptBindings: [],
    });
  });

  it("returns an empty prompt scope list without a database", async () => {
    const response = await getPromptScopesRoute();
    const payload = await response.json();

    expect(payload).toEqual({
      count: 0,
      scopes: [],
    });
  });

  it("validates prompt binding creation payloads", async () => {
    const response = await postPromptBindingsRoute(
      new Request("http://localhost/api/prompt-bindings", {
        method: "POST",
        body: JSON.stringify({
          scopeType: "global",
          scopeId: "scope-1",
          promptComponentId: "component-1",
        }),
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toContain("scopeType");
  });

  it("requires DATABASE_URL before creating prompt bindings", async () => {
    const response = await postPromptBindingsRoute(
      new Request("http://localhost/api/prompt-bindings", {
        method: "POST",
        body: JSON.stringify({
          scopeType: "team",
          scopeId: "00000000-0000-4000-8000-000000000001",
          promptComponentId: "00000000-0000-4000-8000-000000000002",
        }),
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(503);
    expect(payload.error).toContain("DATABASE_URL");
  });

  it("ignores Plane webhook payloads without a task", async () => {
    const response = await postPlaneWebhookRoute(
      new Request("http://localhost/api/plane/webhook", {
        method: "POST",
        body: JSON.stringify({
          action: "ping",
          model: "workspace",
        }),
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      eventType: "unknown",
      action: "ignored",
    });
  });

  it("rejects Plane webhook payloads when a configured shared secret is missing", async () => {
    const previousSecret = process.env.PLANE_WEBHOOK_SECRET;
    process.env.PLANE_WEBHOOK_SECRET = "secret-1";
    try {
      const response = await postPlaneWebhookRoute(
        new Request("http://localhost/api/plane/webhook", {
          method: "POST",
          body: JSON.stringify({
            action: "ping",
            model: "workspace",
          }),
        }),
      );
      const payload = await response.json();

      expect(response.status).toBe(401);
      expect(payload.error).toContain("Unauthorized");
    } finally {
      if (previousSecret === undefined) {
        delete process.env.PLANE_WEBHOOK_SECRET;
      } else {
        process.env.PLANE_WEBHOOK_SECRET = previousSecret;
      }
    }
  });

  it("accepts Plane webhook payloads with the configured shared secret", async () => {
    const previousSecret = process.env.PLANE_WEBHOOK_SECRET;
    process.env.PLANE_WEBHOOK_SECRET = "secret-1";
    try {
      const response = await postPlaneWebhookRoute(
        new Request("http://localhost/api/plane/webhook", {
          method: "POST",
          headers: {
            "x-plane-webhook-secret": "secret-1",
          },
          body: JSON.stringify({
            action: "ping",
            model: "workspace",
          }),
        }),
      );
      const payload = await response.json();

      expect(response.status).toBe(200);
      expect(payload).toEqual({
        eventType: "unknown",
        action: "ignored",
      });
    } finally {
      if (previousSecret === undefined) {
        delete process.env.PLANE_WEBHOOK_SECRET;
      } else {
        process.env.PLANE_WEBHOOK_SECRET = previousSecret;
      }
    }
  });

  it("requires DATABASE_URL before syncing Plane task webhooks", async () => {
    const response = await postPlaneWebhookRoute(
      new Request("http://localhost/api/plane/webhook", {
        method: "POST",
        body: JSON.stringify({
          action: "updated",
          model: "issue",
          issue: {
            id: "plane-1",
            name: "Webhook task",
            labels: ["repo:crs-src"],
          },
        }),
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(503);
    expect(payload.error).toContain("DATABASE_URL");
  });
});
