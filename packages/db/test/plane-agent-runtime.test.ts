import { describe, expect, it, vi } from "vitest";
import {
  applyPlaneProjectionEvent,
  createPlaneRuntimeSnapshotForRun,
  createRunPipeline,
  getPlaneAgentConfigOutboxCursor,
  hashJson,
  latestPlaneOutboxCursor,
  recordRunSnapshot,
  updatePlaneAgentConfigOutboxCursor,
} from "../src/plane-agent-runtime";
import type { DatabaseClient } from "../src/client";

describe("hashJson", () => {
  it("hashes object keys in a stable order", () => {
    expect(hashJson({ b: 2, a: { d: 4, c: 3 } })).toBe(hashJson({ a: { c: 3, d: 4 }, b: 2 }));
  });
});

describe("Plane agent config outbox cursor", () => {
  it("reads and writes workspace-scoped cursor settings", async () => {
    const client = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [{ value: "100" }] })
        .mockResolvedValueOnce({ rows: [] }),
    } as unknown as DatabaseClient;

    await expect(getPlaneAgentConfigOutboxCursor(client, "workspace-1")).resolves.toBe("100");
    await updatePlaneAgentConfigOutboxCursor(client, {
      planeWorkspaceId: "workspace-1",
      cursor: "105",
    });

    expect(client.query).toHaveBeenNthCalledWith(1, expect.stringContaining("from app_settings"), [
      "plane.agent_config_outbox_cursor.workspace-1",
    ]);
    expect(client.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("insert into app_settings"),
      [
        "plane.agent_config_outbox_cursor.workspace-1",
        "105",
        "Plane agent config outbox cursor for workspace workspace-1.",
      ],
    );
  });

  it("selects the greatest numeric outbox id as next cursor", () => {
    expect(latestPlaneOutboxCursor("9", [{ id: "10" }, { id: "2" }, { id: 11n }])).toBe("11");
    expect(latestPlaneOutboxCursor("9", [])).toBe("9");
  });
});

describe("applyPlaneProjectionEvent", () => {
  it("records an outbox event and upserts the matching projection", async () => {
    const client = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [{ id: "event-1" }] })
        .mockResolvedValueOnce({ rows: [] }),
    } as unknown as DatabaseClient;

    await expect(
      applyPlaneProjectionEvent(client, {
        planeWorkspaceId: "workspace-1",
        planeOutboxId: 101,
        entityType: "agent_user_agent",
        entityId: "agent-1",
        operation: "create",
        projectionVersion: 3,
        payload: {
          owner: "user-1",
          key: "default-codex",
          name: "Default Codex",
          runtime: "codex",
          model: "gpt-5-codex",
          tools: ["shell"],
          defaults: { maxTurns: 80 },
          is_active: true,
        },
      }),
    ).resolves.toMatchObject({
      status: "applied",
      entityType: "agent_user_agent",
      entityId: "agent-1",
    });

    expect(client.query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("insert into acp_config_projection_events"),
      expect.arrayContaining(["workspace-1", 101, "agent_user_agent", "agent-1", 3]),
    );
    expect(client.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("insert into acp_user_agent_projections"),
      expect.arrayContaining(["agent-1", "user-1", "Default Codex", "gpt-5-codex"]),
    );
  });

  it("skips duplicate Plane outbox events before applying payload", async () => {
    const client = {
      query: vi.fn().mockResolvedValueOnce({ rows: [] }),
    } as unknown as DatabaseClient;

    await expect(
      applyPlaneProjectionEvent(client, {
        planeWorkspaceId: "workspace-1",
        planeOutboxId: 101,
        entityType: "agent_prompt",
        entityId: "prompt-1",
        projectionVersion: 1,
        payload: {
          name: "Project Context",
          scope: "project",
          kind: "context",
        },
      }),
    ).resolves.toMatchObject({
      status: "skipped",
      entityType: "agent_prompt",
      entityId: "prompt-1",
    });

    expect(client.query).toHaveBeenCalledTimes(1);
  });

  it("marks projection event failed when payload validation fails", async () => {
    const client = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [{ id: "event-1" }] })
        .mockResolvedValueOnce({ rows: [] }),
    } as unknown as DatabaseClient;

    await expect(
      applyPlaneProjectionEvent(client, {
        planeWorkspaceId: "workspace-1",
        planeOutboxId: 102,
        entityType: "agent_prompt",
        entityId: "prompt-1",
        projectionVersion: 1,
        payload: {
          scope: "project",
          kind: "context",
        },
      }),
    ).rejects.toThrow("name");

    expect(client.query).toHaveBeenLastCalledWith(
      expect.stringContaining("update acp_config_projection_events"),
      expect.arrayContaining(["workspace-1", 102, expect.stringContaining("name")]),
    );
  });

  it("upserts active project workspace projections for runtime snapshot joins", async () => {
    const client = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [{ id: "event-1" }] })
        .mockResolvedValueOnce({ rows: [] }),
    } as unknown as DatabaseClient;

    await expect(
      applyPlaneProjectionEvent(client, {
        planeWorkspaceId: "workspace-1",
        planeOutboxId: 103,
        entityType: "agent_project_workspace",
        entityId: "project-workspace-1",
        operation: "update",
        projectionVersion: 2,
        payload: {
          project: "plane-project-1",
          key: "agent-platform",
          worker_card: "mac-studio-worker-1",
          meta_git: { mode: "local" },
          is_active: true,
          updated_at: "2026-06-25T00:00:00.000Z",
        },
      }),
    ).resolves.toMatchObject({
      status: "applied",
      entityType: "agent_project_workspace",
      entityId: "project-workspace-1",
    });

    expect(client.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("insert into acp_project_projections"),
      expect.arrayContaining([
        "project-workspace-1",
        "workspace-1",
        "plane-project-1",
        "agent-platform",
        "mac-studio-worker-1",
        2,
        "active",
      ]),
    );
    expect(client.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("status = excluded.status"),
      expect.any(Array),
    );
  });

  it("upserts role projections from Plane serializer payloads", async () => {
    const client = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [{ id: "event-1" }] })
        .mockResolvedValueOnce({ rows: [] }),
    } as unknown as DatabaseClient;

    await expect(
      applyPlaneProjectionEvent(client, {
        planeWorkspaceId: "workspace-1",
        planeOutboxId: 104,
        entityType: "agent_role",
        entityId: "role-1",
        projectionVersion: 1,
        payload: {
          key: "reviewer",
          name: "Reviewer",
          description: "Reviews changes",
          prompt: "prompt-1",
          metadata: { gate: "agent_review" },
          is_active: true,
        },
      }),
    ).resolves.toMatchObject({
      status: "applied",
      entityType: "agent_role",
      entityId: "role-1",
    });

    expect(client.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("insert into acp_role_projections"),
      expect.arrayContaining(["role-1", "workspace-1", "reviewer", "Reviewer"]),
    );
  });

  it("upserts repository projections from Plane serializer payloads", async () => {
    const client = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [{ id: "event-1" }] })
        .mockResolvedValueOnce({ rows: [] }),
    } as unknown as DatabaseClient;

    await expect(
      applyPlaneProjectionEvent(client, {
        planeWorkspaceId: "workspace-1",
        planeOutboxId: 105,
        entityType: "agent_repository",
        entityId: "repo-1",
        operation: "update",
        projectionVersion: 2,
        payload: {
          project: "project-1",
          key: "plane",
          provider: "github",
          name: "Plane fork",
          url: "git@github.com:michaelx1993/plane.git",
          default_branch: "preview",
          local_path: "/Users/a/plane",
          metadata: { owner: "michaelx1993" },
          is_required: true,
          is_active: true,
        },
      }),
    ).resolves.toMatchObject({
      status: "applied",
      entityType: "agent_repository",
      entityId: "repo-1",
    });

    expect(client.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("insert into acp_repository_projections"),
      expect.arrayContaining(["repo-1", "workspace-1", "project-1", "plane", "github"]),
    );
  });

  it("upserts user secret key projections without storing secret values", async () => {
    const queryMock = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ id: "event-1" }] })
      .mockResolvedValueOnce({ rows: [] });
    const client = {
      query: queryMock,
    } as unknown as DatabaseClient;

    await expect(
      applyPlaneProjectionEvent(client, {
        planeWorkspaceId: "workspace-1",
        planeOutboxId: 106,
        entityType: "agent_user_secret_key",
        entityId: "secret-key-1",
        operation: "create",
        projectionVersion: 1,
        payload: {
          owner: "user-1",
          key: "GITHUB_TOKEN",
          description: "GitHub API token",
          provider: "env",
          provider_ref: "GITHUB_TOKEN",
          value: "secret-value",
          is_active: true,
        },
      }),
    ).resolves.toMatchObject({
      status: "applied",
      entityType: "agent_user_secret_key",
      entityId: "secret-key-1",
    });

    expect(client.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("insert into acp_user_secret_key_projections"),
      expect.arrayContaining(["secret-key-1", "workspace-1", "user-1", "GITHUB_TOKEN"]),
    );
    expect(JSON.stringify(queryMock.mock.calls)).not.toContain("secret-value");
  });
});

describe("recordRunSnapshot", () => {
  it("records immutable snapshot payload with a canonical hash", async () => {
    const createdAt = new Date("2026-06-25T00:00:00.000Z");
    const payload = { task: { id: "task-1" }, prompts: [{ id: "prompt-1" }] };
    const client = {
      query: vi.fn().mockResolvedValueOnce({
        rows: [
          {
            id: "snapshot-1",
            run_id: "run-1",
            snapshot_hash: hashJson(payload),
            payload,
            created_at: createdAt,
          },
        ],
      }),
    } as unknown as DatabaseClient;

    await expect(recordRunSnapshot(client, { runId: "run-1", payload })).resolves.toEqual({
      id: "snapshot-1",
      runId: "run-1",
      snapshotHash: hashJson(payload),
      payload,
      createdAt,
    });

    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("insert into acp_run_snapshots"),
      ["run-1", hashJson(payload), JSON.stringify(payload)],
    );
  });

  it("rejects an existing run snapshot with a different hash", async () => {
    const client = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({
          rows: [
            {
              id: "snapshot-1",
              run_id: "run-1",
              snapshot_hash: "old-hash",
              payload: { old: true },
              created_at: new Date("2026-06-25T00:00:00.000Z"),
            },
          ],
        }),
    } as unknown as DatabaseClient;

    await expect(
      recordRunSnapshot(client, {
        runId: "run-1",
        payload: { new: true },
      }),
    ).rejects.toThrow("different hash");
  });
});

describe("createPlaneRuntimeSnapshotForRun", () => {
  it("freezes Plane projections, prompt stack, worker card and secret key names", async () => {
    const createdAt = new Date("2026-06-25T00:00:00.000Z");
    const client = {
      query: vi.fn(async (query: string, params?: unknown[]) => {
        if (query.includes("from runs")) {
          return {
            rows: [
              {
                run_id: "run-1",
                run_status: "claimed",
                run_attempt: 1,
                lease_owner: "worker-1",
                lease_expires_at: new Date("2026-06-25T00:10:00.000Z"),
                run_created_at: createdAt,
                task_id: "task-1",
                external_task_id: "plane-task-1",
                identifier: "ACP-1",
                title: "Implement snapshot",
                task_state: "Development",
                task_url: "https://plane.example/workspace/ACP-1",
                labels: ["repo:plane"],
                project_id: "project-local-1",
                project_slug: "agent-platform",
                project_name: "Agent Platform",
                project_external_project_id: "plane-project-1",
                team_key: "workspace1",
                team_external_team_id: "plane-workspace-1",
                repository_id: "repo-local-1",
                repository_slug: "plane",
                repository_git_url: "git@github.com:michaelx1993/plane.git",
                repository_default_branch: "main",
                repository_local_path: "/Users/a/plane",
                role_id: "role-local-1",
                role_key: "development",
                role_name: "Development",
                agent_definition_id: "agent-local-1",
                agent_name: "Codex Developer",
                agent_runtime: "codex",
                agent_model: "gpt-5",
                agent_reasoning_effort: "high",
                agent_tool_profile: "full",
                agent_max_turns: 80,
                agent_timeout_seconds: 7200,
                plane_project_workspace_id: "project-workspace-1",
                plane_workspace_id: "plane-workspace-1",
                plane_project_id: "plane-project-1",
                project_default_worker_id: "worker-card-1",
                project_meta_git_policy: { statusPath: "status.md", progressPath: "progress.md" },
                plane_repository_id: "plane-repo-1",
                repository_key: "plane",
                repository_provider: "github",
                repository_url: "git@github.com:michaelx1993/plane.git",
                repository_metadata: { owner: "michaelx1993" },
                plane_role_id: "plane-role-1",
                role_plane_prompt_id: "prompt-role",
                role_metadata: { gate: "agent-review" },
                plane_user_agent_id: "plane-agent-1",
                user_agent_owner_user_id: "user-1",
                user_agent_default_model: "gpt-5",
                user_agent_tool_profile: { tools: ["shell"] },
                user_agent_config_snapshot: {
                  secretKeys: ["GITHUB_TOKEN"],
                  secrets: { DOCKERHUB_TOKEN: "redacted-in-test" },
                },
              },
            ],
          };
        }

        if (query.includes("from acp_worker_card_projections")) {
          return {
            rows: [
              {
                plane_worker_card_id: "worker-card-1",
                worker_id: "worker-1",
                name: "Mac Studio",
                hostname: "mac-studio.local",
                os: "macOS",
                labels: ["local"],
                workspace_root: "/Users/a/aiworkspace",
                status: "online",
                last_seen_at: createdAt,
                updated_at: createdAt,
              },
            ],
          };
        }

        if (query.includes("from acp_prompt_binding_projections")) {
          return {
            rows: [
              {
                plane_binding_id: "binding-agent",
                target_type: "user_agent",
                target_id: "plane-agent-1",
                version_policy: "latest",
                pinned_version_id: null,
                scope: "agent",
                order_index: 0,
                required: true,
                binding_projection_version: "3",
                plane_prompt_id: "prompt-agent",
                prompt_name: "Agent Base",
                prompt_scope: "workspace",
                prompt_kind: "instruction",
                latest_version_id: "version-agent-2",
                prompt_status: "active",
                plane_prompt_version_id: "version-agent-2",
                version: 2,
                body: "Agent prompt",
                variables: [],
                content_hash: "agent-hash",
                version_created_at: createdAt,
              },
              {
                plane_binding_id: "binding-project",
                target_type: "project",
                target_id: "project-workspace-1",
                version_policy: "latest",
                pinned_version_id: null,
                scope: "project",
                order_index: 0,
                required: true,
                binding_projection_version: "4",
                plane_prompt_id: "prompt-project",
                prompt_name: "Project Rules",
                prompt_scope: "project",
                prompt_kind: "instruction",
                latest_version_id: "version-project-1",
                prompt_status: "active",
                plane_prompt_version_id: "version-project-1",
                version: 1,
                body: "Project prompt",
                variables: [],
                content_hash: "project-hash",
                version_created_at: createdAt,
              },
            ],
          };
        }

        if (query.includes("from acp_user_secret_key_projections")) {
          expect(params).toEqual(["plane-workspace-1", "user-1"]);
          return {
            rows: [{ key: "PLANE_SECRET" }, { key: "GITHUB_TOKEN" }],
          };
        }

        if (query.includes("insert into acp_run_snapshots")) {
          const payload = JSON.parse(String(params?.[2]));
          return {
            rows: [
              {
                id: "snapshot-1",
                run_id: "run-1",
                snapshot_hash: params?.[1],
                payload,
                created_at: createdAt,
              },
            ],
          };
        }

        throw new Error(`Unexpected query: ${query}`);
      }),
    } as unknown as DatabaseClient;

    const snapshot = await createPlaneRuntimeSnapshotForRun(client, {
      runId: "run-1",
      promptRelease: {
        id: "release-1",
        contentHash: "release-hash",
        renderedContent: "Legacy prompt",
      },
    });

    expect(snapshot.payload.schemaVersion).toBe("plane-runtime-snapshot.v1");
    expect(snapshot.payload.project).toMatchObject({
      planeProjectWorkspaceId: "project-workspace-1",
      metaGitPolicy: { statusPath: "status.md", progressPath: "progress.md" },
    });
    expect(snapshot.payload.worker).toMatchObject({
      requestedWorkerId: "worker-1",
      workerId: "worker-1",
      name: "Mac Studio",
    });
    expect(snapshot.payload.prompts.map((prompt) => prompt.binding.scope)).toEqual([
      "agent",
      "project",
    ]);
    expect(snapshot.payload.assembledPrompt).toBe("Agent prompt\n\n---\n\nProject prompt");
    expect(snapshot.payload.availableSecretKeys).toEqual([
      "DOCKERHUB_TOKEN",
      "GITHUB_TOKEN",
      "PLANE_SECRET",
    ]);
    expect(JSON.stringify(snapshot.payload)).not.toContain("redacted-in-test");
  });
});

describe("createRunPipeline", () => {
  it("creates a runtime pipeline copy with nodes and transitions", async () => {
    const client = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [{ id: "pipeline-1", run_id: "run-1" }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] }),
    } as unknown as DatabaseClient;

    await expect(
      createRunPipeline(client, {
        runId: "run-1",
        planePlaybookVersionId: "playbook-version-1",
        nodes: [
          {
            nodeKey: "development",
            nodeType: "agent",
            roleKey: "development",
            assignedAgentId: "agent-1",
            gateMode: "auto",
          },
          {
            nodeKey: "human_review",
            nodeType: "human_gate",
            gateMode: "manual",
          },
        ],
        transitions: [
          {
            fromNodeKey: "development",
            toNodeKey: "human_review",
            gateMode: "manual",
          },
        ],
      }),
    ).resolves.toEqual({
      id: "pipeline-1",
      runId: "run-1",
      nodeCount: 2,
      transitionCount: 1,
    });

    expect(client.query).toHaveBeenCalledTimes(4);
    expect(client.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("insert into acp_run_pipeline_nodes"),
      expect.arrayContaining(["pipeline-1", "development", "agent", "development"]),
    );
    expect(client.query).toHaveBeenNthCalledWith(
      4,
      expect.stringContaining("insert into acp_run_pipeline_transitions"),
      expect.arrayContaining(["pipeline-1", "development", "human_review"]),
    );
  });

  it("requires at least one pipeline node", async () => {
    const client = {
      query: vi.fn(),
    } as unknown as DatabaseClient;

    await expect(createRunPipeline(client, { runId: "run-1", nodes: [] })).rejects.toThrow(
      "at least one node",
    );
    expect(client.query).not.toHaveBeenCalled();
  });
});
