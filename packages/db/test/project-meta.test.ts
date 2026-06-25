import { describe, expect, it, vi } from "vitest";
import type { DatabaseClient } from "../src/client";
import { recordProjectMetaGitArtifact } from "../src/project-meta";

describe("recordProjectMetaGitArtifact", () => {
  it("upserts the project meta repo and records one memory commit per changed file", async () => {
    const client = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rows: [
            {
              id: "project-meta-repo-1",
              plane_project_workspace_id: "plane-project-workspace-1",
              local_path: "/var/agent-meta/token",
            },
          ],
        })
        .mockResolvedValueOnce({ rows: [{ id: "memory-commit-1" }] })
        .mockResolvedValueOnce({ rows: [{ id: "memory-commit-2" }] }),
    } as unknown as DatabaseClient;

    await expect(
      recordProjectMetaGitArtifact(client, {
        planeProjectWorkspaceId: "plane-project-workspace-1",
        localPath: "/var/agent-meta/token",
        runId: "run-1",
        commitSha: "abc123",
        filesChanged: ["status.md", "progress.md", "progress.md"],
        operation: "run_summary",
        summary: "Development run succeeded.",
      }),
    ).resolves.toEqual({
      projectMetaRepoId: "project-meta-repo-1",
      planeProjectWorkspaceId: "plane-project-workspace-1",
      localPath: "/var/agent-meta/token",
      commitSha: "abc123",
      filesChanged: ["status.md", "progress.md"],
      memoryCommitIds: ["memory-commit-1", "memory-commit-2"],
    });

    expect(client.query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("insert into acp_project_meta_repos"),
      ["plane-project-workspace-1", "/var/agent-meta/token", null],
    );
    expect(client.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("insert into acp_project_memory_commits"),
      [
        "project-meta-repo-1",
        "run-1",
        "status.md",
        "run_summary",
        "abc123",
        "Development run succeeded.",
      ],
    );
    expect(client.query).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining("insert into acp_project_memory_commits"),
      [
        "project-meta-repo-1",
        "run-1",
        "progress.md",
        "run_summary",
        "abc123",
        "Development run succeeded.",
      ],
    );
  });
});
