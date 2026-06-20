import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it, vi } from "vitest";
import {
  listEphemeralWorkspacesForCleanup,
  markWorkspaceCleaned,
  prepareWorkspaceForRun,
} from "../src/workspaces";
import type { DatabaseClient } from "../src/client";

const execFileAsync = promisify(execFile);

describe("prepareWorkspaceForRun", () => {
  it("creates an ephemeral workspace and records a ready event", async () => {
    const root = await mkdtemp(join(tmpdir(), "acp-workspaces-"));
    const createdAt = new Date("2026-06-19T12:00:00Z");
    const client = {
      query: vi.fn().mockResolvedValue({
        rows: [
          {
            id: "workspace-1",
            run_id: "run-1",
            repository_id: "repo-1",
            strategy: "ephemeral",
            path: `${root}/crs-src/run-1`,
            base_ref: "main",
            head_ref: "agent/run-1",
            status: "ready",
            created_at: createdAt,
            cleaned_at: null,
          },
        ],
      }),
    } as unknown as DatabaseClient;

    try {
      await expect(
        prepareWorkspaceForRun(client, {
          runId: "run-1",
          repositoryId: "repo-1",
          repositorySlug: "crs-src",
          repositoryDefaultBranch: "main",
          workspaceRoot: root,
        }),
      ).resolves.toEqual({
        id: "workspace-1",
        runId: "run-1",
        repositoryId: "repo-1",
        strategy: "ephemeral",
        path: `${root}/crs-src/run-1`,
        baseRef: "main",
        headRef: "agent/run-1",
        status: "ready",
        createdAt,
      });

      const workspaceStat = await stat(`${root}/crs-src/run-1`);
      expect(workspaceStat.isDirectory()).toBe(true);
      expect(client.query).toHaveBeenCalledWith(expect.stringContaining("workspace.ready"), [
        "run-1",
        "repo-1",
        "ephemeral",
        `${root}/crs-src/run-1`,
        "main",
        "agent/run-1",
        expect.any(String),
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("uses repository local path when configured", async () => {
    const root = await mkdtemp(join(tmpdir(), "acp-repo-"));
    const localPath = `${root}/crs-src`;
    const client = {
      query: vi.fn().mockResolvedValue({
        rows: [
          {
            id: "workspace-1",
            run_id: "run-1",
            repository_id: "repo-1",
            strategy: "local-path",
            path: localPath,
            base_ref: "main",
            head_ref: "agent/run-1",
            status: "ready",
            created_at: new Date("2026-06-19T12:00:00Z"),
            cleaned_at: null,
          },
        ],
      }),
    } as unknown as DatabaseClient;

    try {
      await prepareWorkspaceForRun(client, {
        runId: "run-1",
        repositoryId: "repo-1",
        repositorySlug: "crs-src",
        repositoryLocalPath: localPath,
        repositoryDefaultBranch: "main",
        workspaceRoot: "/unused",
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }

    expect(client.query).toHaveBeenCalledWith(expect.any(String), [
      "run-1",
      "repo-1",
      "local-path",
      localPath,
      "main",
      "agent/run-1",
      expect.any(String),
    ]);
  });

  it("creates a git worktree workspace when requested", async () => {
    const root = await mkdtemp(join(tmpdir(), "acp-worktree-"));
    const repoPath = `${root}/source`;
    const workspaceRoot = `${root}/workspaces`;
    const createdAt = new Date("2026-06-19T12:00:00Z");
    const client = {
      query: vi.fn().mockResolvedValue({
        rows: [
          {
            id: "workspace-1",
            run_id: "run-123456789",
            repository_id: "repo-1",
            strategy: "git-worktree",
            path: `${workspaceRoot}/crs-src/run-123456789`,
            base_ref: "main",
            head_ref: "agent/run-1234",
            status: "ready",
            created_at: createdAt,
            cleaned_at: null,
          },
        ],
      }),
    } as unknown as DatabaseClient;

    try {
      await execFileAsync("git", ["init", "-b", "main", repoPath]);
      await execFileAsync("git", ["-C", repoPath, "config", "user.email", "agent@example.com"]);
      await execFileAsync("git", ["-C", repoPath, "config", "user.name", "Agent"]);
      await execFileAsync("git", ["-C", repoPath, "commit", "--allow-empty", "-m", "init"]);

      await expect(
        prepareWorkspaceForRun(client, {
          runId: "run-123456789",
          repositoryId: "repo-1",
          repositorySlug: "crs-src",
          repositoryLocalPath: repoPath,
          repositoryDefaultBranch: "main",
          workspaceRoot,
          strategy: "git-worktree",
        }),
      ).resolves.toEqual({
        id: "workspace-1",
        runId: "run-123456789",
        repositoryId: "repo-1",
        strategy: "git-worktree",
        path: `${workspaceRoot}/crs-src/run-123456789`,
        baseRef: "main",
        headRef: "agent/run-1234",
        status: "ready",
        createdAt,
      });

      const workspaceStat = await stat(`${workspaceRoot}/crs-src/run-123456789/.git`);
      expect(workspaceStat.isFile()).toBe(true);
      expect(client.query).toHaveBeenCalledWith(expect.stringContaining("workspace.ready"), [
        "run-123456789",
        "repo-1",
        "git-worktree",
        `${workspaceRoot}/crs-src/run-123456789`,
        "main",
        "agent/run-1234",
        expect.any(String),
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("workspace cleanup", () => {
  it("lists finished ephemeral and git worktree workspaces by age", async () => {
    const finishedAt = new Date("2026-06-19T12:00:00Z");
    const createdAt = new Date("2026-06-19T10:00:00Z");
    const olderThan = new Date("2026-06-19T13:00:00Z");
    const client = {
      query: vi.fn().mockResolvedValue({
        rows: [
          {
            id: "workspace-1",
            run_id: "run-1",
            repository_id: "repo-1",
            strategy: "ephemeral",
            path: "/tmp/workspaces/repo/run-1",
            base_ref: "main",
            head_ref: "agent/run-1",
            status: "ready",
            created_at: createdAt,
            cleaned_at: null,
            finished_at: finishedAt,
            repository_local_path: "/repos/crs-src",
          },
        ],
      }),
    } as unknown as DatabaseClient;

    await expect(
      listEphemeralWorkspacesForCleanup(client, {
        olderThan,
        limit: 25,
      }),
    ).resolves.toEqual([
      {
        id: "workspace-1",
        runId: "run-1",
        repositoryId: "repo-1",
        strategy: "ephemeral",
        path: "/tmp/workspaces/repo/run-1",
        baseRef: "main",
        headRef: "agent/run-1",
        status: "ready",
        createdAt,
        finishedAt,
        repositoryLocalPath: "/repos/crs-src",
      },
    ]);

    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("workspaces.strategy in ('ephemeral', 'git-worktree')"),
      [olderThan, 25],
    );
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("repositories.local_path as repository_local_path"),
      [olderThan, 25],
    );
  });

  it("marks a workspace as cleaned and records an event", async () => {
    const cleanedAt = new Date("2026-06-19T14:00:00Z");
    const client = {
      query: vi.fn().mockResolvedValue({
        rows: [
          {
            id: "workspace-1",
            run_id: "run-1",
            repository_id: "repo-1",
            strategy: "ephemeral",
            path: "/tmp/workspaces/repo/run-1",
            base_ref: "main",
            head_ref: "agent/run-1",
            status: "cleaned",
            created_at: new Date("2026-06-19T10:00:00Z"),
            cleaned_at: cleanedAt,
          },
        ],
      }),
    } as unknown as DatabaseClient;

    await expect(
      markWorkspaceCleaned(client, {
        workspaceId: "workspace-1",
        runId: "run-1",
        path: "/tmp/workspaces/repo/run-1",
      }),
    ).resolves.toMatchObject({
      id: "workspace-1",
      runId: "run-1",
      status: "cleaned",
      cleanedAt,
    });

    expect(client.query).toHaveBeenCalledWith(expect.stringContaining("workspace.cleaned"), [
      "workspace-1",
      "run-1",
      "/tmp/workspaces/repo/run-1",
    ]);
  });
});
