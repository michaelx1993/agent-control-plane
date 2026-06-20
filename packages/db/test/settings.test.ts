import { describe, expect, it, vi } from "vitest";
import {
  archiveAgentDefinitionSettings,
  archiveRepositorySettings,
  archiveRoleSettings,
  createAgentDefinitionSettings,
  createPromptBinding,
  createRepositorySettings,
  createRoleSettings,
  getAuditEventSummary,
  getProjectSettingsSnapshot,
  listAuditEvents,
  listPromptBindingAuditEvents,
  listPromptBindings,
  updateAgentDefinitionSettings,
  updatePromptBindingStatus,
  updateRepositorySettings,
  updateRoleSettings,
} from "../src/settings";
import type { DatabaseClient } from "../src/client";

describe("getProjectSettingsSnapshot", () => {
  it("returns teams, projects, repositories, roles, and agents", async () => {
    const client = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rows: [{ id: "team-1", key: "TOK", name: "token-team", description: "Team" }],
        })
        .mockResolvedValueOnce({
          rows: [
            {
              id: "project-1",
              team_id: "team-1",
              team_key: "TOK",
              slug: "token",
              name: "token",
              description: "Project",
              status: "active",
            },
          ],
        })
        .mockResolvedValueOnce({
          rows: [
            {
              id: "repo-1",
              project_id: "project-1",
              project_slug: "token",
              slug: "crs-src",
              git_url: "git@github.com:michaelx1993/crs-src.git",
              default_branch: "main",
              local_path: null,
              status: "active",
              description: "Repo",
            },
          ],
        })
        .mockResolvedValueOnce({
          rows: [
            {
              id: "role-1",
              key: "development",
              name: "Development Agent",
              active_states: ["Development"],
              next_states: ["Code Review"],
              status: "active",
              description: "Build",
            },
          ],
        })
        .mockResolvedValueOnce({
          rows: [
            {
              id: "agent-1",
              role_id: "role-1",
              role_key: "development",
              name: "Development Agent",
              runtime: "openhands",
              model: "gpt-5.5",
              reasoning_effort: "high",
              tool_profile: "default",
              max_turns: 80,
              timeout_seconds: 7200,
              status: "active",
            },
          ],
        }),
    } as unknown as DatabaseClient;

    await expect(getProjectSettingsSnapshot(client)).resolves.toMatchObject({
      teams: [{ id: "team-1", key: "TOK", name: "token-team", description: "Team" }],
      projects: [{ id: "project-1", teamId: "team-1", slug: "token" }],
      repositories: [{ id: "repo-1", projectId: "project-1", slug: "crs-src" }],
      roles: [
        { id: "role-1", key: "development", activeStates: ["Development"], status: "active" },
      ],
      agentDefinitions: [{ id: "agent-1", roleId: "role-1", roleKey: "development" }],
    });
  });
});

describe("prompt binding management", () => {
  it("lists prompt bindings with resolved scope names", async () => {
    const now = new Date("2026-06-19T10:00:00Z");
    const client = {
      query: vi.fn().mockResolvedValue({
        rows: [
          {
            id: "binding-1",
            scope_type: "team",
            scope_id: "team-1",
            scope_name: "token-team",
            prompt_component_id: "component-1",
            prompt_component_name: "Team Prompt",
            prompt_component_version: 1,
            prompt_component_status: "active",
            order_index: 1,
            environment: "dev",
            status: "active",
            created_at: now,
            updated_at: now,
          },
        ],
      }),
    } as unknown as DatabaseClient;

    await expect(listPromptBindings(client)).resolves.toEqual([
      {
        id: "binding-1",
        scope: "team",
        scopeId: "team-1",
        scopeName: "token-team",
        promptComponentId: "component-1",
        promptComponentName: "Team Prompt",
        promptComponentVersion: 1,
        promptComponentStatus: "active",
        orderIndex: 1,
        environment: "dev",
        status: "active",
        createdAt: now,
        updatedAt: now,
      },
    ]);
  });

  it("creates a prompt binding after validating scope and component", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ exists: true }] })
      .mockResolvedValueOnce({ rows: [{ exists: true }] })
      .mockResolvedValueOnce({ rows: [{ id: "binding-1" }] })
      .mockResolvedValueOnce({ rows: [] });
    const client = { query } as unknown as DatabaseClient;

    await expect(
      createPromptBinding(client, {
        scope: "repo",
        scopeId: "repo-1",
        promptComponentId: "component-1",
        orderIndex: 3,
        actor: {
          userId: "user-1",
          name: "Operator",
          roles: ["prompt_editor"],
        },
      }),
    ).resolves.toEqual({
      updated: true,
      bindingId: "binding-1",
    });

    expect(query).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining("insert into prompt_bindings"),
      ["repo", "repo-1", "component-1", 3, "dev", "pending"],
    );
    expect(query).toHaveBeenLastCalledWith(expect.stringContaining("insert into audit_events"), [
      "user-1",
      "prompt_binding.request",
      "binding-1",
      "Prompt binding approval requested.",
      "pending",
      "Operator",
      ["prompt_editor"],
    ]);
  });

  it("rejects bindings for missing scopes", async () => {
    const client = {
      query: vi.fn().mockResolvedValue({ rows: [{ exists: false }] }),
    } as unknown as DatabaseClient;

    await expect(
      createPromptBinding(client, {
        scope: "role",
        scopeId: "missing",
        promptComponentId: "component-1",
        orderIndex: 0,
      }),
    ).resolves.toEqual({
      updated: false,
      reason: "scope_not_found",
    });
  });

  it("updates binding status", async () => {
    const client = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [{ id: "binding-1", status: "active" }] })
        .mockResolvedValueOnce({ rows: [] }),
    } as unknown as DatabaseClient;

    await expect(
      updatePromptBindingStatus(client, "binding-1", "active", {
        userId: "user-1",
        name: "Approver",
        roles: ["prompt_admin"],
      }),
    ).resolves.toEqual({
      updated: true,
      bindingId: "binding-1",
    });
    expect(client.query).toHaveBeenLastCalledWith(
      expect.stringContaining("insert into audit_events"),
      [
        "user-1",
        "prompt_binding.approve",
        "binding-1",
        "Prompt binding status changed to active.",
        "active",
        "Approver",
        ["prompt_admin"],
      ],
    );
  });

  it("lists prompt binding audit events with actor and status", async () => {
    const now = new Date("2026-06-19T12:00:00Z");
    const client = {
      query: vi.fn().mockResolvedValue({
        rows: [
          {
            id: "audit-1",
            action: "prompt_binding.approve",
            entity_type: "prompt_binding",
            entity_id: "binding-1",
            actor_name: "Approver",
            message: "Prompt binding status changed to active.",
            payload: { status: "active" },
            created_at: now,
          },
        ],
      }),
    } as unknown as DatabaseClient;

    await expect(listPromptBindingAuditEvents(client, 5)).resolves.toEqual([
      {
        id: "audit-1",
        action: "prompt_binding.approve",
        entityType: "prompt_binding",
        entityId: "binding-1",
        bindingId: "binding-1",
        actorName: "Approver",
        message: "Prompt binding status changed to active.",
        status: "active",
        createdAt: now,
      },
    ]);
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining("from audit_events"), [
      "prompt_binding",
      5,
    ]);
  });

  it("lists audit events with filters", async () => {
    const now = new Date("2026-06-19T12:00:00Z");
    const client = {
      query: vi.fn().mockResolvedValue({
        rows: [
          {
            id: "audit-2",
            action: "monitoring_thresholds.update",
            entity_type: "app_setting",
            entity_id: "00000000-0000-4000-8000-000000000000",
            actor_name: "operator",
            message: "Monitoring thresholds updated.",
            payload: {},
            created_at: now,
          },
        ],
      }),
    } as unknown as DatabaseClient;

    await expect(
      listAuditEvents(client, {
        entityType: "app_setting",
        action: "monitoring_thresholds.update",
        actor: "operator",
        limit: 25,
      }),
    ).resolves.toEqual([
      {
        id: "audit-2",
        action: "monitoring_thresholds.update",
        entityType: "app_setting",
        entityId: "00000000-0000-4000-8000-000000000000",
        bindingId: "00000000-0000-4000-8000-000000000000",
        actorName: "operator",
        message: "Monitoring thresholds updated.",
        createdAt: now,
      },
    ]);
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining("users.name ilike"), [
      "app_setting",
      "monitoring_thresholds.update",
      "%operator%",
      25,
    ]);
  });

  it("summarizes audit events by action, entity type, and actor", async () => {
    const firstEventAt = new Date("2026-06-19T09:00:00.000Z");
    const lastEventAt = new Date("2026-06-19T10:00:00.000Z");
    const createdAfter = new Date("2026-06-19T00:00:00.000Z");
    const client = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rows: [
            {
              total_events: "4",
              unique_actors: "2",
              first_event_at: firstEventAt,
              last_event_at: lastEventAt,
            },
          ],
        })
        .mockResolvedValueOnce({
          rows: [
            { key: "prompt_binding.approve", count: "3" },
            { key: "monitoring_thresholds.update", count: "1" },
          ],
        })
        .mockResolvedValueOnce({
          rows: [
            { key: "prompt_binding", count: "3" },
            { key: "app_setting", count: "1" },
          ],
        })
        .mockResolvedValueOnce({
          rows: [
            { key: "operator", count: "3" },
            { key: "admin", count: "1" },
          ],
        }),
    } as unknown as DatabaseClient;

    await expect(
      getAuditEventSummary(client, {
        actor: "operator",
        createdAfter,
        limit: 5,
      }),
    ).resolves.toEqual({
      totalEvents: 4,
      uniqueActors: 2,
      firstEventAt,
      lastEventAt,
      actionCounts: [
        { key: "prompt_binding.approve", count: 3 },
        { key: "monitoring_thresholds.update", count: 1 },
      ],
      entityTypeCounts: [
        { key: "prompt_binding", count: 3 },
        { key: "app_setting", count: 1 },
      ],
      actorCounts: [
        { key: "operator", count: 3 },
        { key: "admin", count: 1 },
      ],
    });
    expect(client.query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("count(distinct coalesce"),
      ["%operator%", createdAfter],
    );
    expect(client.query).toHaveBeenNthCalledWith(2, expect.stringContaining("group by key"), [
      "%operator%",
      createdAfter,
      5,
    ]);
  });
});

describe("settings mutations", () => {
  it("updates repository settings", async () => {
    const client = {
      query: vi.fn().mockResolvedValue({ rows: [{ id: "repo-1" }] }),
    } as unknown as DatabaseClient;

    await expect(
      updateRepositorySettings(client, {
        repositoryId: "repo-1",
        slug: "crs-src",
        gitUrl: "git@github.com:michaelx1993/crs-src.git",
        defaultBranch: "main",
        status: "active",
        localPath: "/repo/crs-src",
        description: "CRS",
      }),
    ).resolves.toEqual({
      updated: true,
      id: "repo-1",
    });
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining("update repositories"), [
      "repo-1",
      "crs-src",
      "git@github.com:michaelx1993/crs-src.git",
      "main",
      "/repo/crs-src",
      "active",
      "CRS",
    ]);
  });

  it("creates and archives repository settings", async () => {
    const client = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [{ id: "repo-2" }] })
        .mockResolvedValueOnce({ rows: [{ id: "repo-2" }] }),
    } as unknown as DatabaseClient;

    await expect(
      createRepositorySettings(client, {
        projectId: "project-1",
        slug: "sub2",
        gitUrl: "git@github.com:michaelx1993/sub3.git",
        defaultBranch: "main",
      }),
    ).resolves.toEqual({
      updated: true,
      id: "repo-2",
    });
    await expect(archiveRepositorySettings(client, "repo-2")).resolves.toEqual({
      updated: true,
      id: "repo-2",
    });
  });

  it("updates role settings", async () => {
    const client = {
      query: vi.fn().mockResolvedValue({ rows: [{ id: "role-1" }] }),
    } as unknown as DatabaseClient;

    await expect(
      updateRoleSettings(client, {
        roleId: "role-1",
        name: "Development Agent",
        activeStates: ["Development"],
        nextStates: ["Code Review", "Blocked"],
        status: "active",
        description: "Build",
      }),
    ).resolves.toEqual({
      updated: true,
      id: "role-1",
    });
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining("update roles"), [
      "role-1",
      "Development Agent",
      ["Development"],
      ["Code Review", "Blocked"],
      "active",
      "Build",
    ]);
  });

  it("creates and archives role settings", async () => {
    const client = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [{ id: "role-2" }] })
        .mockResolvedValueOnce({ rows: [{ id: "role-2" }] }),
    } as unknown as DatabaseClient;

    await expect(
      createRoleSettings(client, {
        key: "qa",
        name: "QA Agent",
        activeStates: ["Code Review"],
        nextStates: ["Human Review"],
      }),
    ).resolves.toEqual({
      updated: true,
      id: "role-2",
    });
    await expect(archiveRoleSettings(client, "role-2")).resolves.toEqual({
      updated: true,
      id: "role-2",
    });
  });

  it("rejects role settings without usable states", async () => {
    const client = {
      query: vi.fn(),
    } as unknown as DatabaseClient;

    await expect(
      updateRoleSettings(client, {
        roleId: "role-1",
        name: "Development Agent",
        activeStates: [""],
        nextStates: [" "],
        status: "active",
      }),
    ).resolves.toEqual({
      updated: false,
      reason: "invalid_input",
    });
    expect(client.query).not.toHaveBeenCalled();
  });

  it("updates agent definition settings", async () => {
    const client = {
      query: vi.fn().mockResolvedValue({ rows: [{ id: "agent-1" }] }),
    } as unknown as DatabaseClient;

    await expect(
      updateAgentDefinitionSettings(client, {
        agentDefinitionId: "agent-1",
        name: "Development Agent",
        runtime: "openhands",
        model: "gpt-5.5",
        reasoningEffort: "high",
        toolProfile: "default",
        maxTurns: 80,
        timeoutSeconds: 7200,
        status: "active",
      }),
    ).resolves.toEqual({
      updated: true,
      id: "agent-1",
    });
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining("update agent_definitions"), [
      "agent-1",
      "Development Agent",
      "openhands",
      "gpt-5.5",
      "high",
      "default",
      80,
      7200,
      "active",
    ]);
  });

  it("creates and archives agent definition settings", async () => {
    const client = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [{ id: "agent-2" }] })
        .mockResolvedValueOnce({ rows: [{ id: "agent-2" }] }),
    } as unknown as DatabaseClient;

    await expect(
      createAgentDefinitionSettings(client, {
        roleId: "role-1",
        name: "QA Agent",
        runtime: "openhands",
        model: "gpt-5.5",
        reasoningEffort: "high",
        toolProfile: "default",
        maxTurns: 80,
        timeoutSeconds: 7200,
      }),
    ).resolves.toEqual({
      updated: true,
      id: "agent-2",
    });
    await expect(archiveAgentDefinitionSettings(client, "agent-2")).resolves.toEqual({
      updated: true,
      id: "agent-2",
    });
  });

  it("rejects invalid agent definition settings", async () => {
    const client = {
      query: vi.fn(),
    } as unknown as DatabaseClient;

    await expect(
      updateAgentDefinitionSettings(client, {
        agentDefinitionId: "agent-1",
        name: "Development Agent",
        runtime: "openhands",
        model: "",
        reasoningEffort: "medium",
        toolProfile: "default",
        maxTurns: 0,
        timeoutSeconds: 7200,
        status: "active",
      }),
    ).resolves.toEqual({
      updated: false,
      reason: "invalid_input",
    });
    expect(client.query).not.toHaveBeenCalled();
  });
});
