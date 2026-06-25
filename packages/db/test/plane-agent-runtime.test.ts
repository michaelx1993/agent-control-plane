import { describe, expect, it, vi } from "vitest";
import {
  applyPlaneProjectionEvent,
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
        planeOutboxId: 103,
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
        planeOutboxId: 104,
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
