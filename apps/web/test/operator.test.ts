import { describe, expect, it } from "vitest";
import {
  authorizeOperatorApiRequest,
  canAccessOperatorPath,
  configuredOperatorRoles,
  createOperatorSessionToken,
  isOperatorApiAuthRequired,
  isPublicApiPath,
  isPublicPagePath,
  OPERATOR_SESSION_COOKIE,
  verifyOperatorSessionToken,
} from "../src/auth";
import {
  canApprovePromptBinding,
  canManageMonitoringSettings,
  canManageProjectSettings,
  canRequestPromptBinding,
  type OperatorContext,
} from "../src/operator";
import { authorizeWorkerApiRequest, isWorkerApiPath } from "../src/worker-auth";

describe("operator prompt binding permissions", () => {
  it("allows prompt editors to request binding approval", () => {
    const operator: OperatorContext = {
      name: "editor",
      roles: ["prompt_editor"],
    };

    expect(canRequestPromptBinding(operator)).toBe(true);
    expect(canApprovePromptBinding(operator)).toBe(false);
  });

  it("allows prompt admins to approve binding changes", () => {
    const operator: OperatorContext = {
      name: "approver",
      roles: ["prompt_admin"],
    };

    expect(canRequestPromptBinding(operator)).toBe(true);
    expect(canApprovePromptBinding(operator)).toBe(true);
  });

  it("denies viewers from prompt binding mutation", () => {
    const operator: OperatorContext = {
      name: "viewer",
      roles: ["viewer"],
    };

    expect(canRequestPromptBinding(operator)).toBe(false);
    expect(canApprovePromptBinding(operator)).toBe(false);
  });
});

describe("operator monitoring settings permissions", () => {
  it("allows owners and admins to update monitoring thresholds", () => {
    expect(canManageMonitoringSettings({ name: "owner", roles: ["owner"] })).toBe(true);
    expect(canManageMonitoringSettings({ name: "admin", roles: ["admin"] })).toBe(true);
  });

  it("denies non-admin operators from monitoring threshold updates", () => {
    expect(canManageMonitoringSettings({ name: "editor", roles: ["prompt_editor"] })).toBe(false);
    expect(canManageMonitoringSettings({ name: "viewer", roles: ["viewer"] })).toBe(false);
  });
});

describe("operator project settings permissions", () => {
  it("allows only owners and admins to mutate project settings", () => {
    expect(canManageProjectSettings({ name: "owner", roles: ["owner"] })).toBe(true);
    expect(canManageProjectSettings({ name: "admin", roles: ["admin"] })).toBe(true);
    expect(canManageProjectSettings({ name: "prompt-admin", roles: ["prompt_admin"] })).toBe(false);
    expect(canManageProjectSettings({ name: "viewer", roles: ["viewer"] })).toBe(false);
  });
});

describe("operator API token auth", () => {
  it("parses configured operator roles", () => {
    expect(configuredOperatorRoles({ ACP_OPERATOR_ROLES: "owner, prompt_admin,viewer" })).toEqual([
      "owner",
      "prompt_admin",
      "viewer",
    ]);
  });

  it("keeps operator API auth disabled until a token is configured", async () => {
    const request = { headers: new Headers() };

    expect(isOperatorApiAuthRequired({})).toBe(false);
    await expect(authorizeOperatorApiRequest(request, {})).resolves.toEqual({
      ok: true,
      reason: "not_configured",
    });
  });

  it("supports the legacy control plane token as a fallback", async () => {
    await expect(
      authorizeOperatorApiRequest(
        { headers: new Headers({ authorization: "Bearer legacy-token" }) },
        { CONTROL_PLANE_API_TOKEN: "legacy-token" },
      ),
    ).resolves.toEqual({ ok: true });

    await expect(
      authorizeOperatorApiRequest(
        { headers: new Headers({ authorization: "Bearer current-token" }) },
        {
          ACP_OPERATOR_API_TOKEN: "current-token",
          CONTROL_PLANE_API_TOKEN: "legacy-token",
        },
      ),
    ).resolves.toEqual({ ok: true });
  });

  it("accepts bearer and dedicated operator token headers", async () => {
    await expect(
      authorizeOperatorApiRequest(
        { headers: new Headers({ authorization: "Bearer control-token" }) },
        { CONTROL_PLANE_API_TOKEN: "control-token" },
      ),
    ).resolves.toEqual({ ok: true });

    await expect(
      authorizeOperatorApiRequest(
        { headers: new Headers({ authorization: "Bearer secret-token" }) },
        { ACP_OPERATOR_API_TOKEN: "secret-token" },
      ),
    ).resolves.toEqual({ ok: true });

    await expect(
      authorizeOperatorApiRequest(
        { headers: new Headers({ "x-acp-operator-token": "secret-token" }) },
        { ACP_OPERATOR_API_TOKEN: "secret-token" },
      ),
    ).resolves.toEqual({ ok: true });
  });

  it("accepts signed operator session cookies", async () => {
    const issuedAt = new Date();
    const verifiedAt = new Date(issuedAt.getTime() + 30 * 1000);
    const token = await createOperatorSessionToken(
      {
        userId: "00000000-0000-4000-8000-000000000901",
        name: "local-operator",
        roles: ["owner"],
      },
      "session-secret-that-is-long-enough",
      24 * 60 * 60,
      issuedAt,
    );

    await expect(
      verifyOperatorSessionToken(token, "session-secret-that-is-long-enough", verifiedAt),
    ).resolves.toMatchObject({
      name: "local-operator",
      roles: ["owner"],
    });

    await expect(
      authorizeOperatorApiRequest(
        { headers: new Headers({ cookie: `${OPERATOR_SESSION_COOKIE}=${token}` }) },
        { ACP_OPERATOR_SESSION_SECRET: "session-secret-that-is-long-enough" },
      ),
    ).resolves.toMatchObject({
      ok: true,
      session: {
        name: "local-operator",
        roles: ["owner"],
      },
    });
  });

  it("rejects expired or invalid operator sessions", async () => {
    const token = await createOperatorSessionToken(
      {
        name: "local-operator",
        roles: ["owner"],
      },
      "session-secret-that-is-long-enough",
      60,
      new Date("2026-06-19T12:00:00Z"),
    );

    await expect(
      authorizeOperatorApiRequest(
        { headers: new Headers({ cookie: `${OPERATOR_SESSION_COOKIE}=${token}` }) },
        { ACP_OPERATOR_SESSION_SECRET: "wrong-secret" },
      ),
    ).resolves.toEqual({
      ok: false,
      reason: "invalid_session",
    });

    await expect(
      verifyOperatorSessionToken(
        token,
        "session-secret-that-is-long-enough",
        new Date("2026-06-19T12:02:00Z"),
      ),
    ).resolves.toBeUndefined();
  });

  it("rejects missing or invalid operator tokens", async () => {
    await expect(
      authorizeOperatorApiRequest({ headers: new Headers() }, { ACP_OPERATOR_API_TOKEN: "secret" }),
    ).resolves.toEqual({
      ok: false,
      reason: "missing_token",
    });

    await expect(
      authorizeOperatorApiRequest(
        { headers: new Headers({ authorization: "Bearer wrong" }) },
        { ACP_OPERATOR_API_TOKEN: "secret" },
      ),
    ).resolves.toEqual({
      ok: false,
      reason: "invalid_token",
    });
  });

  it("keeps readiness and Plane webhook paths public", () => {
    expect(isPublicApiPath("/api/readiness")).toBe(true);
    expect(isPublicApiPath("/api/readiness/")).toBe(true);
    expect(isPublicApiPath("/api/plane/webhook")).toBe(true);
    expect(isPublicApiPath("/api/plane/webhook/")).toBe(true);
    expect(isPublicApiPath("/api/auth/login")).toBe(true);
    expect(isPublicApiPath("/api/auth/logout")).toBe(true);
    expect(isPublicApiPath("/api/runs")).toBe(false);
    expect(isPublicApiPath("/api/auth/session")).toBe(false);
    expect(isPublicPagePath("/login")).toBe(true);
    expect(isPublicPagePath("/")).toBe(false);
  });

  it("allows owners and admins to access every operator path", () => {
    expect(canAccessOperatorPath("/users", "GET", ["owner"])).toEqual({ ok: true });
    expect(canAccessOperatorPath("/api/settings/repositories", "POST", ["admin"])).toEqual({
      ok: true,
    });
  });

  it("allows read-only operator pages for viewers", () => {
    expect(canAccessOperatorPath("/", "GET", ["viewer"])).toEqual({ ok: true });
    expect(canAccessOperatorPath("/audit", "GET", ["viewer"])).toEqual({ ok: true });
    expect(canAccessOperatorPath("/tasks", "GET", ["viewer"])).toEqual({ ok: true });
    expect(canAccessOperatorPath("/api/tasks", "GET", ["viewer"])).toEqual({ ok: true });
    expect(canAccessOperatorPath("/api/tasks/task-1", "GET", ["viewer"])).toEqual({ ok: true });
    expect(canAccessOperatorPath("/prompt-components", "GET", ["viewer"])).toEqual({ ok: true });
    expect(canAccessOperatorPath("/api/prompt-components", "GET", ["viewer"])).toEqual({
      ok: true,
    });
  });

  it("denies privileged pages and mutations without required roles", () => {
    expect(canAccessOperatorPath("/users", "GET", ["viewer"])).toEqual({
      ok: false,
      requiredRoles: ["owner", "admin"],
    });
    expect(canAccessOperatorPath("/settings", "GET", ["viewer"])).toEqual({
      ok: false,
      requiredRoles: ["owner", "admin", "prompt_admin", "prompt_editor"],
    });
    expect(canAccessOperatorPath("/api/settings/repositories", "POST", ["prompt_admin"])).toEqual({
      ok: false,
      requiredRoles: ["owner", "admin"],
    });
    expect(
      canAccessOperatorPath("/api/prompt-bindings/binding-1/status", "POST", ["prompt_editor"]),
    ).toEqual({
      ok: false,
      requiredRoles: ["owner", "admin", "prompt_admin"],
    });
    expect(canAccessOperatorPath("/api/tasks/task-1/transition", "POST", ["viewer"])).toEqual({
      ok: false,
      requiredRoles: ["owner", "admin"],
    });
    expect(canAccessOperatorPath("/api/tasks/task-1/rework", "POST", ["prompt_admin"])).toEqual({
      ok: false,
      requiredRoles: ["owner", "admin"],
    });
    expect(canAccessOperatorPath("/api/tasks/task-1/feedback", "POST", ["prompt_editor"])).toEqual({
      ok: false,
      requiredRoles: ["owner", "admin"],
    });
  });

  it("allows owners and admins to mutate task gate state and feedback", () => {
    expect(canAccessOperatorPath("/api/tasks/task-1/transition", "POST", ["admin"])).toEqual({
      ok: true,
    });
    expect(canAccessOperatorPath("/api/tasks/task-1/rework", "POST", ["owner"])).toEqual({
      ok: true,
    });
    expect(canAccessOperatorPath("/api/tasks/task-1/feedback", "POST", ["admin"])).toEqual({
      ok: true,
    });
  });

  it("allows prompt scoped roles on prompt surfaces", () => {
    expect(canAccessOperatorPath("/settings", "GET", ["prompt_editor"])).toEqual({ ok: true });
    expect(canAccessOperatorPath("/api/prompt-bindings", "POST", ["prompt_editor"])).toEqual({
      ok: true,
    });
    expect(
      canAccessOperatorPath("/api/prompt-bindings/binding-1/status", "POST", ["prompt_admin"]),
    ).toEqual({ ok: true });
  });
});

describe("worker API token auth", () => {
  it("recognizes Worker API paths before operator auth", () => {
    expect(isWorkerApiPath("/api/worker/v1/register")).toBe(true);
    expect(isWorkerApiPath("/api/worker/v1/runs/run-1/heartbeat")).toBe(true);
    expect(isWorkerApiPath("/api/worker/v1")).toBe(false);
    expect(isWorkerApiPath("/api/runs")).toBe(false);
  });

  it("keeps Worker API auth disabled until a token is configured", () => {
    expect(authorizeWorkerApiRequest({ headers: new Headers() }, {})).toEqual({
      ok: true,
      reason: "not_configured",
    });
  });

  it("accepts bearer and dedicated worker token headers", () => {
    expect(
      authorizeWorkerApiRequest(
        {
          headers: new Headers({
            authorization: "Bearer worker-token",
            "x-acp-worker-id": "worker-1",
          }),
        },
        { ACP_WORKER_API_TOKEN: "worker-token" },
      ),
    ).toEqual({ ok: true, workerId: "worker-1" });

    expect(
      authorizeWorkerApiRequest(
        {
          headers: new Headers({
            "x-acp-worker-token": "worker-token",
            "x-acp-worker-id": "worker-2",
          }),
        },
        { ACP_WORKER_API_TOKEN: "worker-token" },
      ),
    ).toEqual({ ok: true, workerId: "worker-2" });
  });

  it("rejects missing worker tokens, invalid worker tokens, and missing worker ids", () => {
    expect(
      authorizeWorkerApiRequest({ headers: new Headers() }, { ACP_WORKER_API_TOKEN: "x" }),
    ).toEqual({
      ok: false,
      reason: "missing_token",
    });

    expect(
      authorizeWorkerApiRequest(
        {
          headers: new Headers({
            authorization: "Bearer wrong",
            "x-acp-worker-id": "worker-1",
          }),
        },
        { ACP_WORKER_API_TOKEN: "x" },
      ),
    ).toEqual({
      ok: false,
      reason: "invalid_token",
    });

    expect(
      authorizeWorkerApiRequest(
        { headers: new Headers({ authorization: "Bearer x" }) },
        { ACP_WORKER_API_TOKEN: "x" },
      ),
    ).toEqual({
      ok: false,
      reason: "missing_worker_id",
    });
  });
});
