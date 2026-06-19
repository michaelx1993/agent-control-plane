import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";

import {
  GET as getPromptBindingsRoute,
  POST as postPromptBindingsRoute,
} from "./prompt-bindings/route";
import { POST as postPlaneWebhookRoute } from "./plane/webhook/route";
import {
  GET as getPromptComponentsRoute,
  POST as postPromptComponentsRoute,
} from "./prompt-components/route";
import { GET as getPromptComponentDiffRoute } from "./prompt-components/diff/route";
import { POST as postPromptComponentRollbackRoute } from "./prompt-components/[componentId]/rollback/route";
import { GET as getMonitoringRoute } from "./monitoring/route";
import { GET as getPromptMetricsRoute } from "./prompt-metrics/route";
import { GET as getPromptReleasesRoute } from "./prompt-releases/route";
import { GET as getPromptScopesRoute } from "./prompt-scopes/route";
import { GET as getRunDetailRoute } from "./runs/[runId]/route";
import { POST as postRunFeedbackRoute } from "./runs/[runId]/feedback/route";
import { GET as getReadinessRoute } from "./readiness/route";
import { POST as postTaskRetryRoute } from "./tasks/[taskId]/retry/route";
import { POST as postTaskTransitionRoute } from "./tasks/[taskId]/transition/route";
import { GET as getTasksRoute } from "./tasks/route";
import { GET as getTimelineRoute } from "./timeline/route";
import { databaseBaselineReadinessFromCounts } from "../../lib/control-plane-service";

describe("new mock API routes", () => {
  it("returns task queue JSON shaped for a future API client", async () => {
    const response = await getTasksRoute();
    const payload = await response.json();

    expect(payload.count).toBe(payload.tasks.length);
    expect(payload.summary).toMatchObject({
      blocked: expect.any(Number),
      eligible: expect.any(Number),
      failed: expect.any(Number),
      retryCapped: expect.any(Number),
      running: expect.any(Number),
    });
    expect(payload.tasks[0]).toMatchObject({
      eligible: expect.any(Boolean),
      id: expect.any(String),
      labels: expect.any(Array),
      lease: expect.any(String),
      attempt: expect.any(Number),
      dispatchStatus: expect.stringMatching(
        /^(eligible|gated|retry_capped|budget_blocked|repo_concurrency|role_concurrency)$/,
      ),
      maxAttempts: expect.any(Number),
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

  it("returns prompt version metrics for historical run performance", async () => {
    const response = await getPromptMetricsRoute();
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.count).toBe(payload.promptMetrics.length);
    expect(payload.promptMetrics[0]).toMatchObject({
      promptReleaseId: expect.any(String),
      runCount: expect.any(Number),
      successRate: expect.any(Number),
      avgInputTokens: expect.any(Number),
      avgOutputTokens: expect.any(Number),
      avgCostUsd: expect.any(String),
    });
  });

  it("returns production monitoring metrics", async () => {
    const response = await getMonitoringRoute(new Request("http://localhost/api/monitoring"));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      generatedAt: expect.any(String),
      queue: {
        total: expect.any(Number),
        eligible: expect.any(Number),
        blocked: expect.any(Number),
        retryCapped: expect.any(Number),
      },
      runs: {
        total: expect.any(Number),
        successRate: expect.any(Number),
      },
      usage: {
        totalTokens: expect.any(Number),
        costUsd: expect.any(String),
      },
      stalledRuns: expect.any(Array),
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
      attempt: expect.any(Number),
      maxAttempts: expect.any(Number),
      events: expect.any(Array),
      openHandsUrl: expect.stringContaining("/conversations/"),
      traceId: expect.any(String),
      workspacePath: expect.any(String),
      workspaceStatus: expect.any(String),
    });
    expect(payload.run.events[0]).toMatchObject({
      payload: expect.any(Object),
    });

    const missingResponse = await getRunDetailRoute(
      new Request("http://localhost/api/runs/missing"),
      {
        params: Promise.resolve({ runId: "missing" }),
      },
    );
    expect(missingResponse.status).toBe(404);
  });

  it("returns 404 instead of leaking DB errors for invalid DB run ids", async () => {
    const previousDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = "postgresql://agent:agent@localhost:54329/test";
    try {
      const response = await getRunDetailRoute(new Request("http://localhost/api/runs/run-7741"), {
        params: Promise.resolve({ runId: "run-7741" }),
      });
      const payload = await response.json();

      expect(response.status).toBe(404);
      expect(payload.error).toContain("not found");
    } finally {
      if (previousDatabaseUrl === undefined) {
        delete process.env.DATABASE_URL;
      } else {
        process.env.DATABASE_URL = previousDatabaseUrl;
      }
    }
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

  it("requires DATABASE_URL before releasing task retry", async () => {
    const response = await postTaskRetryRoute(
      new Request("http://localhost/api/tasks/ACP-1/retry", {
        method: "POST",
        body: JSON.stringify({
          reason: "Try again after review.",
        }),
      }),
      { params: Promise.resolve({ taskId: "ACP-1" }) },
    );
    const payload = await response.json();

    expect(response.status).toBe(503);
    expect(payload.error).toContain("DATABASE_URL");
  });

  it("returns operator timeline JSON for dashboard event inspection", async () => {
    const response = await getTimelineRoute();
    const payload = await response.json();

    expect(payload.count).toBe(payload.timeline.length);
    expect(payload.timeline[0]).toMatchObject({
      id: expect.any(String),
      source: expect.stringMatching(/^(run|audit|feedback)$/),
      tone: expect.stringMatching(/^(nominal|attention|degraded)$/),
      title: expect.any(String),
      detail: expect.any(String),
      href: expect.any(String),
    });
  });

  it("returns readiness checks grouped by integration", async () => {
    const response = await getReadinessRoute();
    const payload = await response.json();

    expect(payload).toMatchObject({
      status: expect.stringMatching(/^(ready|warning|missing)$/),
      checkedAt: expect.any(String),
      categories: expect.any(Array),
    });
    expect(payload.categories.map((category: { id: string }) => category.id)).toContain("plane");
  });

  it("marks database baseline readiness missing when seed data is incomplete", () => {
    expect(
      databaseBaselineReadinessFromCounts({ teams: 1, repositories: 3, roles: 6, agents: 6 }),
    ).toMatchObject({
      id: "DATABASE_BASELINE",
      status: "ready",
      detail: expect.stringContaining("active agents=6"),
    });

    expect(
      databaseBaselineReadinessFromCounts({ teams: 1, repositories: 0, roles: 6, agents: 0 }),
    ).toMatchObject({
      id: "DATABASE_BASELINE",
      status: "missing",
      detail: expect.stringContaining("Run database seed"),
    });
  });

  it("validates manual task transition payloads", async () => {
    const response = await postTaskTransitionRoute(
      new Request("http://localhost/api/tasks/ACP-1/transition", {
        method: "POST",
        body: JSON.stringify({
          nextState: "Invalid",
        }),
      }),
      { params: Promise.resolve({ taskId: "ACP-1" }) },
    );
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toContain("nextState");
  });

  it("requires DATABASE_URL before manually transitioning tasks", async () => {
    const response = await postTaskTransitionRoute(
      new Request("http://localhost/api/tasks/ACP-1/transition", {
        method: "POST",
        body: JSON.stringify({
          nextState: "Done",
          reason: "Manual close after review.",
        }),
      }),
      { params: Promise.resolve({ taskId: "ACP-1" }) },
    );
    const payload = await response.json();

    expect(response.status).toBe(503);
    expect(payload.error).toContain("DATABASE_URL");
  });

  it("accepts Blocked as a manual task transition target", async () => {
    const response = await postTaskTransitionRoute(
      new Request("http://localhost/api/tasks/ACP-1/transition", {
        method: "POST",
        body: JSON.stringify({
          nextState: "Blocked",
          reason: "Lease stalled and needs operator inspection.",
        }),
      }),
      { params: Promise.resolve({ taskId: "ACP-1" }) },
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

  it("validates prompt component diff query params", async () => {
    const response = await getPromptComponentDiffRoute(
      new Request("http://localhost/api/prompt-components/diff?left=component-1"),
    );
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toContain("left and right");
  });

  it("requires DATABASE_URL before diffing prompt components", async () => {
    const response = await getPromptComponentDiffRoute(
      new Request("http://localhost/api/prompt-components/diff?left=component-1&right=component-2"),
    );
    const payload = await response.json();

    expect(response.status).toBe(503);
    expect(payload.error).toContain("DATABASE_URL");
  });

  it("requires DATABASE_URL before rolling back prompt components", async () => {
    const response = await postPromptComponentRollbackRoute(
      new Request("http://localhost/api/prompt-components/component-1/rollback", {
        method: "POST",
        body: JSON.stringify({
          author: "operator",
          changelog: "Rollback after bad prompt.",
        }),
      }),
      { params: Promise.resolve({ componentId: "component-1" }) },
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

  it("accepts Plane webhook payloads with a valid HMAC signature", async () => {
    const previousSecret = process.env.PLANE_WEBHOOK_SECRET;
    process.env.PLANE_WEBHOOK_SECRET = "secret-1";
    const body = JSON.stringify({
      action: "ping",
      model: "workspace",
    });
    try {
      const response = await postPlaneWebhookRoute(
        new Request("http://localhost/api/plane/webhook", {
          method: "POST",
          headers: {
            "x-plane-signature": hmacSha256(body, "secret-1"),
          },
          body,
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

  it("rejects Plane webhook payloads with an invalid HMAC signature", async () => {
    const previousSecret = process.env.PLANE_WEBHOOK_SECRET;
    process.env.PLANE_WEBHOOK_SECRET = "secret-1";
    try {
      const response = await postPlaneWebhookRoute(
        new Request("http://localhost/api/plane/webhook", {
          method: "POST",
          headers: {
            "x-plane-signature": hmacSha256("different body", "secret-1"),
          },
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

function hmacSha256(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}
