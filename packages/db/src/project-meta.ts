import type { DatabaseClient } from "./client.js";

export interface ProjectMetaGitArtifactInput {
  planeProjectWorkspaceId: string;
  localPath: string;
  remoteUrl?: string;
  runId?: string;
  commitSha?: string;
  filesChanged: string[];
  operation: string;
  summary?: string;
}

export interface ProjectMetaGitArtifactRecord {
  projectMetaRepoId: string;
  planeProjectWorkspaceId: string;
  localPath: string;
  commitSha?: string;
  filesChanged: string[];
  memoryCommitIds: string[];
}

interface ProjectMetaRepoRow {
  id: string;
  plane_project_workspace_id: string;
  local_path: string;
}

interface ProjectMemoryCommitRow {
  id: string;
}

export async function recordProjectMetaGitArtifact(
  client: DatabaseClient,
  input: ProjectMetaGitArtifactInput,
): Promise<ProjectMetaGitArtifactRecord> {
  const repo = await upsertProjectMetaRepo(client, input);
  const memoryCommitIds: string[] = [];

  for (const filePath of uniqueNonEmptyStrings(input.filesChanged)) {
    const result = await client.query<ProjectMemoryCommitRow>(
      `
        insert into acp_project_memory_commits (
          id,
          project_meta_repo_id,
          run_id,
          file_path,
          operation,
          commit_sha,
          summary,
          created_at
        )
        values (gen_random_uuid(), $1, $2, $3, $4, $5, $6, now())
        returning id
      `,
      [
        repo.id,
        input.runId ?? null,
        filePath,
        input.operation,
        input.commitSha ?? null,
        input.summary ?? null,
      ],
    );

    const row = result.rows[0];
    if (row) {
      memoryCommitIds.push(row.id);
    }
  }

  return {
    projectMetaRepoId: repo.id,
    planeProjectWorkspaceId: repo.plane_project_workspace_id,
    localPath: repo.local_path,
    ...(input.commitSha ? { commitSha: input.commitSha } : {}),
    filesChanged: uniqueNonEmptyStrings(input.filesChanged),
    memoryCommitIds,
  };
}

async function upsertProjectMetaRepo(
  client: DatabaseClient,
  input: ProjectMetaGitArtifactInput,
): Promise<ProjectMetaRepoRow> {
  const result = await client.query<ProjectMetaRepoRow>(
    `
      insert into acp_project_meta_repos (
        id,
        plane_project_workspace_id,
        local_path,
        remote_url,
        status,
        created_at,
        updated_at
      )
      values (gen_random_uuid(), $1, $2, $3, 'active', now(), now())
      on conflict (plane_project_workspace_id)
      do update set
        local_path = excluded.local_path,
        remote_url = excluded.remote_url,
        status = 'active',
        updated_at = now()
      returning id, plane_project_workspace_id, local_path
    `,
    [input.planeProjectWorkspaceId, input.localPath, input.remoteUrl ?? null],
  );

  const row = result.rows[0];
  if (!row) {
    throw new Error(
      `Failed to upsert project meta repo for Plane project workspace: ${input.planeProjectWorkspaceId}`,
    );
  }

  return row;
}

function uniqueNonEmptyStrings(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
