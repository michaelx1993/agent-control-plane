import { describe, expect, it, vi } from "vitest";
import {
  activatePromptComponentVersion,
  createPromptComponentVersion,
  createPromptReleaseForRun,
  diffPromptComponents,
  getPromptComponentDetail,
  getPromptComponentMetrics,
  getPromptReleaseDetail,
  listPromptComponents,
  listPromptReleases,
} from "../src/prompts";
import type { DatabaseClient } from "../src/client";

describe("createPromptReleaseForRun", () => {
  it("renders bound components and writes an immutable prompt release", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [
          {
            run_id: "run-1",
            prompt_release_id: null,
            task_id: "task-1",
            task_identifier: "TOKEN-1",
            task_title: "Build",
            task_state: "Development",
            repository_id: "repo-1",
            repository_slug: "crs-src",
            role_id: "role-1",
            role_key: "development",
            agent_definition_id: "agent-1",
            agent_name: "Development Agent",
            team_id: "team-1",
            project_id: "project-1",
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: "component-1",
            scope_type: "global",
            name: "Global",
            version: 1,
            content: "中文输出",
            order_index: 0,
          },
          {
            id: "component-2",
            scope_type: "project",
            name: "Project",
            version: 1,
            content: "repo 必填",
            order_index: 1,
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [{ body: "需要修复边界条件" }] })
      .mockResolvedValue({ rows: [] });
    const client = { query } as unknown as DatabaseClient;

    const release = await createPromptReleaseForRun(client, "run-1");

    expect(release.runId).toBe("run-1");
    expect(release.componentIds).toEqual(["component-1", "component-2"]);
    expect(release.renderedContent).toContain("## global: Global v1");
    expect(release.renderedContent).toContain("Task: TOKEN-1 Build");
    expect(release.renderedContent).toContain("需要修复边界条件");
    expect(release.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("insert into prompt_releases"), [
      release.id,
      "task-1",
      "repo-1",
      "role-1",
      "agent-1",
      release.contentHash,
      release.renderedContent,
    ]);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("update runs"), [
      "run-1",
      release.id,
    ]);
  });

  it("returns an existing prompt release without rereading active bindings", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [
          {
            run_id: "run-1",
            prompt_release_id: "release-1",
            task_id: "task-1",
            task_identifier: "TOKEN-1",
            task_title: "Build",
            task_state: "Development",
            repository_id: "repo-1",
            repository_slug: "crs-src",
            role_id: "role-1",
            role_key: "development",
            agent_definition_id: "agent-1",
            agent_name: "Development Agent",
            team_id: "team-1",
            project_id: "project-1",
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: "release-1",
            task_id: "task-1",
            repository_id: "repo-1",
            role_id: "role-1",
            agent_definition_id: "agent-1",
            content_hash: "hash-v1",
            rendered_content: "historical prompt v1",
            component_ids: ["component-v1"],
          },
        ],
      });
    const client = { query } as unknown as DatabaseClient;

    await expect(createPromptReleaseForRun(client, "run-1")).resolves.toEqual({
      id: "release-1",
      runId: "run-1",
      taskId: "task-1",
      repositoryId: "repo-1",
      roleId: "role-1",
      agentDefinitionId: "agent-1",
      contentHash: "hash-v1",
      renderedContent: "historical prompt v1",
      componentIds: ["component-v1"],
    });

    expect(query).toHaveBeenCalledTimes(2);
    expect(query).not.toHaveBeenCalledWith(
      expect.stringContaining("from prompt_bindings"),
      expect.anything(),
    );
    expect(query).not.toHaveBeenCalledWith(
      expect.stringContaining("insert into prompt_releases"),
      expect.anything(),
    );
  });
});

describe("prompt component management", () => {
  it("lists prompt components with hashes and binding counts", async () => {
    const createdAt = new Date("2026-06-19T10:00:00Z");
    const client = {
      query: vi.fn().mockResolvedValue({
        rows: [
          {
            id: "component-1",
            scope_type: "team",
            scope_id: "team-1",
            name: "Team Prompt",
            version: 2,
            status: "active",
            content: "中文输出",
            changelog: "更新",
            author: "operator",
            bound_count: "1",
            created_at: createdAt,
            updated_at: createdAt,
          },
        ],
      }),
    } as unknown as DatabaseClient;

    await expect(
      listPromptComponents(client, { scope: "team", status: "active" }),
    ).resolves.toEqual([
      {
        id: "component-1",
        scope: "team",
        scopeId: "team-1",
        name: "Team Prompt",
        version: 2,
        status: "active",
        author: "operator",
        changelog: "更新",
        contentHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        boundCount: 1,
        createdAt,
        updatedAt: createdAt,
      },
    ]);
  });

  it("creates the next prompt component version", async () => {
    const createdAt = new Date("2026-06-19T10:00:00Z");
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ next_version: 3 }] })
      .mockResolvedValueOnce({ rows: [{ id: "component-3" }] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: "component-3",
            scope_type: "role",
            scope_id: "role-1",
            name: "Development",
            version: 3,
            status: "draft",
            content: "新版 prompt",
            changelog: "draft",
            author: "operator",
            bound_count: "0",
            created_at: createdAt,
            updated_at: createdAt,
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: "component-3",
            scope_type: "role",
            scope_id: "role-1",
            name: "Development",
            version: 3,
            status: "draft",
            content: "新版 prompt",
            changelog: "draft",
            author: "operator",
            bound_count: "0",
            created_at: createdAt,
            updated_at: createdAt,
          },
        ],
      });
    const client = { query } as unknown as DatabaseClient;

    const component = await createPromptComponentVersion(client, {
      scope: "role",
      scopeId: "role-1",
      name: "Development",
      content: "新版 prompt",
      status: "draft",
      changelog: "draft",
      author: "operator",
    });

    expect(component).toMatchObject({
      id: "component-3",
      scope: "role",
      scopeId: "role-1",
      name: "Development",
      version: 3,
      status: "draft",
    });
    expect(query).toHaveBeenCalledWith(expect.stringContaining("insert into prompt_components"), [
      "role",
      "role-1",
      "Development",
      3,
      "draft",
      "新版 prompt",
      "draft",
      "operator",
    ]);
  });

  it("activates one version and rewires active bindings", async () => {
    const createdAt = new Date("2026-06-19T10:00:00Z");
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [
          {
            id: "component-2",
            scope_type: "repo",
            scope_id: "repo-1",
            name: "Repo Prompt",
            version: 2,
            status: "draft",
            content: "v2",
            changelog: null,
            author: null,
            bound_count: "0",
            created_at: createdAt,
            updated_at: createdAt,
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: "component-2",
            scope_type: "repo",
            scope_id: "repo-1",
            name: "Repo Prompt",
            version: 2,
            status: "draft",
            content: "v2",
            changelog: null,
            author: null,
            bound_count: "0",
            created_at: createdAt,
            updated_at: createdAt,
          },
        ],
      })
      .mockResolvedValue({ rows: [] });
    const client = { query } as unknown as DatabaseClient;

    await expect(activatePromptComponentVersion(client, "component-2")).resolves.toEqual({
      updated: true,
      componentId: "component-2",
    });
    expect(query).toHaveBeenCalledWith(expect.stringContaining("set\n        status = case"), [
      "component-2",
      "repo",
      "Repo Prompt",
      "repo-1",
    ]);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("update prompt_bindings"), [
      "component-2",
      "repo",
      "Repo Prompt",
      "repo-1",
    ]);
  });

  it("diffs prompt component versions", async () => {
    const createdAt = new Date("2026-06-19T10:00:00Z");
    const rows = [
      {
        id: "component-1",
        scope_type: "team",
        scope_id: "team-1",
        name: "Team Prompt",
        version: 1,
        status: "archived",
        content: "a\nb",
        changelog: null,
        author: null,
        bound_count: "0",
        created_at: createdAt,
        updated_at: createdAt,
      },
      {
        id: "component-2",
        scope_type: "team",
        scope_id: "team-1",
        name: "Team Prompt",
        version: 2,
        status: "active",
        content: "a\nc",
        changelog: null,
        author: null,
        bound_count: "1",
        created_at: createdAt,
        updated_at: createdAt,
      },
    ];
    const client = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [rows[0]] })
        .mockResolvedValueOnce({ rows: [rows[1]] })
        .mockResolvedValueOnce({ rows })
        .mockResolvedValueOnce({ rows: [...rows].reverse() }),
    } as unknown as DatabaseClient;

    const diff = await diffPromptComponents(client, "component-1", "component-2");

    expect(diff?.lines).toEqual([
      { type: "unchanged", content: "a" },
      { type: "removed", content: "b" },
      { type: "added", content: "c" },
    ]);
  });
});

describe("getPromptComponentMetrics", () => {
  it("summarizes prompt version usage, quality, token, and cost metrics", async () => {
    const createdAt = new Date("2026-06-19T10:00:00Z");
    const finishedAt = new Date("2026-06-19T10:05:00Z");
    const componentRow = {
      id: "component-1",
      scope_type: "role",
      scope_id: "role-1",
      name: "Development",
      version: 2,
      status: "active",
      content: "开发 prompt",
      changelog: null,
      author: null,
      bound_count: "1",
      created_at: createdAt,
      updated_at: createdAt,
    };
    const client = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [componentRow] })
        .mockResolvedValueOnce({ rows: [componentRow] })
        .mockResolvedValueOnce({
          rows: [
            {
              release_count: "3",
              run_count: "2",
              succeeded_run_count: "1",
              failed_run_count: "1",
              blocked_run_count: "0",
              token_total: "3000",
              cost_usd: "0.123456",
              first_used_at: createdAt,
              last_used_at: finishedAt,
            },
          ],
        })
        .mockResolvedValueOnce({
          rows: [
            {
              run_id: "run-1",
              task_identifier: "TOK-1",
              repository_slug: "crs-src",
              role_key: "development",
              status: "succeeded",
              token_total: "1200",
              cost_usd: "0.050000",
              created_at: createdAt,
              finished_at: finishedAt,
            },
          ],
        }),
    } as unknown as DatabaseClient;

    await expect(getPromptComponentMetrics(client, "component-1")).resolves.toEqual({
      componentId: "component-1",
      releaseCount: 3,
      runCount: 2,
      succeededRunCount: 1,
      failedRunCount: 1,
      blockedRunCount: 0,
      successRate: 0.5,
      tokenTotal: 3000,
      costUsd: 0.123456,
      firstUsedAt: createdAt,
      lastUsedAt: finishedAt,
      recentRuns: [
        {
          runId: "run-1",
          taskIdentifier: "TOK-1",
          repositorySlug: "crs-src",
          roleKey: "development",
          status: "succeeded",
          tokenTotal: 1200,
          costUsd: 0.05,
          createdAt,
          finishedAt,
        },
      ],
    });
  });
});

describe("listPromptReleases", () => {
  it("returns operator prompt release summaries", async () => {
    const createdAt = new Date("2026-06-19T10:00:00Z");
    const client = {
      query: vi.fn().mockResolvedValue({
        rows: [
          {
            id: "release-1",
            task_identifier: "TOKEN-1",
            repository_slug: "crs-src",
            role_key: "development",
            agent_name: "Development Agent",
            content_hash: "abc",
            component_count: "2",
            created_at: createdAt,
          },
        ],
      }),
    } as unknown as DatabaseClient;

    await expect(listPromptReleases(client, 500)).resolves.toEqual([
      {
        id: "release-1",
        taskIdentifier: "TOKEN-1",
        repositorySlug: "crs-src",
        roleKey: "development",
        agentName: "Development Agent",
        contentHash: "abc",
        componentCount: 2,
        createdAt,
      },
    ]);

    expect(client.query).toHaveBeenCalledWith(expect.any(String), [200]);
  });
});

describe("getPromptReleaseDetail", () => {
  it("returns rendered prompt, component details, and linked runs", async () => {
    const createdAt = new Date("2026-06-19T10:00:00Z");
    const client = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rows: [
            {
              id: "release-1",
              task_id: "task-1",
              task_identifier: "TOKEN-1",
              task_title: "Build",
              repository_id: "repo-1",
              repository_slug: "crs-src",
              role_id: "role-1",
              role_key: "development",
              agent_definition_id: "agent-1",
              agent_name: "Development Agent",
              content_hash: "hash",
              rendered_content: "final prompt",
              created_at: createdAt,
            },
          ],
        })
        .mockResolvedValueOnce({
          rows: [
            {
              prompt_component_id: "component-1",
              scope_type: "team",
              name: "Team",
              version: 1,
              order_index: 0,
              content_hash: "component-hash",
              content: "team prompt",
            },
          ],
        })
        .mockResolvedValueOnce({
          rows: [
            {
              run_id: "run-1",
              status: "succeeded",
              attempt: 1,
              created_at: createdAt,
            },
          ],
        }),
    } as unknown as DatabaseClient;

    await expect(getPromptReleaseDetail(client, "release-1")).resolves.toEqual({
      id: "release-1",
      taskId: "task-1",
      taskIdentifier: "TOKEN-1",
      taskTitle: "Build",
      repositoryId: "repo-1",
      repositorySlug: "crs-src",
      roleId: "role-1",
      roleKey: "development",
      agentDefinitionId: "agent-1",
      agentName: "Development Agent",
      contentHash: "hash",
      renderedContent: "final prompt",
      createdAt,
      components: [
        {
          promptComponentId: "component-1",
          scope: "team",
          name: "Team",
          version: 1,
          orderIndex: 0,
          contentHash: "component-hash",
          content: "team prompt",
        },
      ],
      runs: [
        {
          runId: "run-1",
          status: "succeeded",
          attempt: 1,
          createdAt,
        },
      ],
    });
  });
});
