import { afterEach, describe, expect, it, vi } from "vitest";
import { PlaneApiError } from "../src/client";
import {
  fetchPlaneAgentConfigOutboxEvents,
  fetchPlaneTaskAndCommentSyncRecords,
} from "../src/sync";

const config = {
  baseUrl: "https://plane.test",
  apiKey: "token",
  workspaceSlug: "workspace",
  projectId: "project-id",
  projectSlug: "tok",
};

afterEach(() => {
  vi.useRealTimers();
});

describe("Plane polling sync", () => {
  it("fetches agent config outbox events for ACP projection sync", async () => {
    const listOptions: unknown[] = [];

    await expect(
      fetchPlaneAgentConfigOutboxEvents(
        config,
        {
          async listAgentConfigOutbox(_workspaceSlug, options) {
            listOptions.push(options);
            return [
              {
                id: 101,
                entity_type: "agent_prompt",
                entity_id: "prompt-1",
                projection_version: 3,
                payload: {
                  name: "Project Context",
                  scope: "project",
                  kind: "context",
                },
              },
            ];
          },
        },
        { afterId: 100, limit: 10 },
      ),
    ).resolves.toEqual([
      {
        id: 101,
        entity_type: "agent_prompt",
        entity_id: "prompt-1",
        projection_version: 3,
        payload: {
          name: "Project Context",
          scope: "project",
          kind: "context",
        },
      },
    ]);

    expect(listOptions).toEqual([{ afterId: 100, limit: 10 }]);
  });

  it("fetches work items and comment feedback records", async () => {
    const records = await fetchPlaneTaskAndCommentSyncRecords(config, {
      async listProjectLabels() {
        return [{ id: "label-1", name: "repo:crs" }];
      },
      async listProjectStates() {
        return [{ id: "state-1", name: "Development" }];
      },
      async listWorkItems() {
        return [
          {
            id: "issue-1",
            name: "Build feature",
            state: "state-1",
            labels: ["label-1"],
            sequence_id: 7,
            priority: "high",
            updated_at: "2026-06-19T12:00:00.000Z",
          },
        ];
      },
      async listWorkItemComments() {
        return [
          {
            id: "comment-1",
            comment_stripped: "请修复边界条件",
            updated_at: "2026-06-19T12:10:00.000Z",
          },
          {
            id: "comment-empty",
            comment_stripped: "",
          },
        ];
      },
    });

    expect(records.tasks).toEqual([
      {
        externalTaskId: "issue-1",
        identifier: "TOK-7",
        title: "Build feature",
        state: "Development",
        labels: ["repo:crs"],
        priority: 2,
        url: "https://plane.test/workspace/workspace/projects/project-id/issues/issue-1",
        syncCursor: "2026-06-19T12:00:00.000Z",
      },
    ]);
    expect(records.comments).toEqual([
      {
        externalTaskId: "issue-1",
        body: "请修复边界条件",
        externalUrl:
          "https://plane.test/workspace/workspace/projects/project-id/issues/issue-1#comment-comment-1",
        syncCursor: "2026-06-19T12:10:00.000Z",
      },
    ]);
  });

  it("filters tasks and comments by sync cursor while still checking all work item comments", async () => {
    const commentedWorkItems: string[] = [];
    const records = await fetchPlaneTaskAndCommentSyncRecords(
      config,
      {
        async listProjectLabels() {
          return [{ id: "label-1", name: "repo:crs" }];
        },
        async listProjectStates() {
          return [{ id: "state-1", name: "Development" }];
        },
        async listWorkItems() {
          return [
            {
              id: "issue-old",
              name: "Old task",
              state: "state-1",
              labels: ["label-1"],
              sequence_id: 1,
              priority: "medium",
              updated_at: "2026-06-19T12:00:00.000Z",
            },
            {
              id: "issue-new",
              name: "New task",
              state: "state-1",
              labels: ["label-1"],
              sequence_id: 2,
              priority: "high",
              updated_at: "2026-06-19T12:10:00.000Z",
            },
          ];
        },
        async listWorkItemComments(_workspaceSlug, _projectId, workItemId) {
          commentedWorkItems.push(workItemId);
          return [
            {
              id: `${workItemId}-old-comment`,
              comment_stripped: "old feedback",
              updated_at: "2026-06-19T12:01:00.000Z",
            },
            {
              id: `${workItemId}-new-comment`,
              comment_stripped: "new feedback",
              updated_at: "2026-06-19T12:11:00.000Z",
            },
          ];
        },
      },
      { syncCursor: "2026-06-19T12:05:00.000Z" },
    );

    expect(commentedWorkItems).toEqual(["issue-old", "issue-new"]);
    expect(records.tasks.map((task) => task.externalTaskId)).toEqual(["issue-new"]);
    expect(records.comments.map((comment) => comment.externalTaskId)).toEqual([
      "issue-old",
      "issue-new",
    ]);
    expect(records.comments.map((comment) => comment.body)).toEqual([
      "new feedback",
      "new feedback",
    ]);
  });

  it("passes sync cursor as server-side updated_after when server delta is enabled", async () => {
    const listWorkItemOptions: unknown[] = [];
    const records = await fetchPlaneTaskAndCommentSyncRecords(
      config,
      {
        async listProjectLabels() {
          return [{ id: "label-1", name: "repo:crs" }];
        },
        async listProjectStates() {
          return [{ id: "state-1", name: "Development" }];
        },
        async listWorkItems(_workspaceSlug, _projectId, options) {
          listWorkItemOptions.push(options);
          return [
            {
              id: "issue-new",
              name: "New task",
              state: "state-1",
              labels: ["label-1"],
              sequence_id: 2,
              priority: "high",
              updated_at: "2026-06-19T12:10:00.000Z",
            },
          ];
        },
        async listWorkItemComments() {
          return [];
        },
      },
      { syncCursor: "2026-06-19T12:05:00.000Z", serverDelta: true },
    );

    expect(listWorkItemOptions).toEqual([{ updatedAfter: "2026-06-19T12:05:00.000Z" }, undefined]);
    expect(records.tasks.map((task) => task.externalTaskId)).toEqual(["issue-new"]);
  });

  it("uses server delta for task updates while still scanning all work item comments", async () => {
    const listWorkItemOptions: unknown[] = [];
    const commentedWorkItems: string[] = [];
    const records = await fetchPlaneTaskAndCommentSyncRecords(
      config,
      {
        async listProjectLabels() {
          return [{ id: "label-1", name: "repo:crs" }];
        },
        async listProjectStates() {
          return [{ id: "state-1", name: "Development" }];
        },
        async listWorkItems(_workspaceSlug, _projectId, options) {
          listWorkItemOptions.push(options);
          if (options?.updatedAfter) {
            return [
              {
                id: "issue-new",
                name: "New task",
                state: "state-1",
                labels: ["label-1"],
                sequence_id: 2,
                priority: "high",
                updated_at: "2026-06-19T12:10:00.000Z",
              },
            ];
          }

          return [
            {
              id: "issue-old",
              name: "Old task with new comment",
              state: "state-1",
              labels: ["label-1"],
              sequence_id: 1,
              priority: "medium",
              updated_at: "2026-06-19T12:00:00.000Z",
            },
            {
              id: "issue-new",
              name: "New task",
              state: "state-1",
              labels: ["label-1"],
              sequence_id: 2,
              priority: "high",
              updated_at: "2026-06-19T12:10:00.000Z",
            },
          ];
        },
        async listWorkItemComments(_workspaceSlug, _projectId, workItemId) {
          commentedWorkItems.push(workItemId);
          if (workItemId === "issue-old") {
            return [
              {
                id: "old-task-new-comment",
                comment_stripped: "old task feedback after cursor",
                updated_at: "2026-06-19T12:11:00.000Z",
              },
            ];
          }

          return [];
        },
      },
      { syncCursor: "2026-06-19T12:05:00.000Z", serverDelta: true },
    );

    expect(listWorkItemOptions).toEqual([{ updatedAfter: "2026-06-19T12:05:00.000Z" }, undefined]);
    expect(records.tasks.map((task) => task.externalTaskId)).toEqual(["issue-new"]);
    expect(commentedWorkItems).toEqual(["issue-old", "issue-new"]);
    expect(records.comments).toEqual([
      {
        externalTaskId: "issue-old",
        body: "old task feedback after cursor",
        externalUrl:
          "https://plane.test/workspace/workspace/projects/project-id/issues/issue-old#comment-old-task-new-comment",
        syncCursor: "2026-06-19T12:11:00.000Z",
      },
    ]);
  });

  it("falls back to full work item polling when Plane does not support server delta", async () => {
    const listWorkItemOptions: unknown[] = [];
    const records = await fetchPlaneTaskAndCommentSyncRecords(
      config,
      {
        async listProjectLabels() {
          return [{ id: "label-1", name: "repo:crs" }];
        },
        async listProjectStates() {
          return [{ id: "state-1", name: "Development" }];
        },
        async listWorkItems(_workspaceSlug, _projectId, options) {
          listWorkItemOptions.push(options);
          if (options?.updatedAfter) {
            throw new Error("Plane API 400 Bad Request: unknown query param updated_after");
          }

          return [
            {
              id: "issue-old",
              name: "Old task",
              state: "state-1",
              labels: ["label-1"],
              sequence_id: 1,
              priority: "medium",
              updated_at: "2026-06-19T12:00:00.000Z",
            },
            {
              id: "issue-new",
              name: "New task",
              state: "state-1",
              labels: ["label-1"],
              sequence_id: 2,
              priority: "high",
              updated_at: "2026-06-19T12:10:00.000Z",
            },
          ];
        },
        async listWorkItemComments() {
          return [];
        },
      },
      { syncCursor: "2026-06-19T12:05:00.000Z", serverDelta: true },
    );

    expect(listWorkItemOptions).toEqual([{ updatedAfter: "2026-06-19T12:05:00.000Z" }, undefined]);
    expect(records.tasks.map((task) => task.externalTaskId)).toEqual(["issue-new"]);
  });

  it("keeps task sync alive when a work item comment fetch fails", async () => {
    const records = await fetchPlaneTaskAndCommentSyncRecords(
      config,
      {
        async listProjectLabels() {
          return [{ id: "label-1", name: "repo:crs" }];
        },
        async listProjectStates() {
          return [{ id: "state-1", name: "Development" }];
        },
        async listWorkItems() {
          return [
            {
              id: "issue-ok",
              name: "Task with comments",
              state: "state-1",
              labels: ["label-1"],
              sequence_id: 1,
              updated_at: "2026-06-19T12:00:00.000Z",
            },
            {
              id: "issue-fail",
              name: "Task with broken comments",
              state: "state-1",
              labels: ["label-1"],
              sequence_id: 2,
              updated_at: "2026-06-19T12:01:00.000Z",
            },
          ];
        },
        async listWorkItemComments(_workspaceSlug, _projectId, workItemId) {
          if (workItemId === "issue-fail") {
            throw new Error("Plane comments unavailable");
          }

          return [
            {
              id: "comment-1",
              comment_stripped: "still synced",
              updated_at: "2026-06-19T12:02:00.000Z",
            },
          ];
        },
      },
      { retryAttempts: 1 },
    );

    expect(records.tasks.map((task) => task.externalTaskId)).toEqual(["issue-ok", "issue-fail"]);
    expect(records.comments).toHaveLength(1);
    expect(records.comments[0]?.body).toBe("still synced");
    expect(records.warnings).toEqual([
      {
        type: "comment_fetch_failed",
        externalTaskId: "issue-fail",
        message: "Plane comments unavailable",
      },
    ]);
  });

  it("retries transient global Plane API failures", async () => {
    let workItemAttempts = 0;
    const records = await fetchPlaneTaskAndCommentSyncRecords(
      config,
      {
        async listProjectLabels() {
          return [{ id: "label-1", name: "repo:crs" }];
        },
        async listProjectStates() {
          return [{ id: "state-1", name: "Development" }];
        },
        async listWorkItems() {
          workItemAttempts += 1;
          if (workItemAttempts === 1) {
            throw new Error("temporary Plane outage");
          }

          return [
            {
              id: "issue-1",
              name: "Recovered task",
              state: "state-1",
              labels: ["label-1"],
              sequence_id: 1,
              updated_at: "2026-06-19T12:00:00.000Z",
            },
          ];
        },
        async listWorkItemComments() {
          return [];
        },
      },
      { retryAttempts: 2, retryDelayMs: 0 },
    );

    expect(workItemAttempts).toBe(2);
    expect(records.tasks.map((task) => task.externalTaskId)).toEqual(["issue-1"]);
    expect(records.warnings).toEqual([]);
  });

  it("retries rate-limited Plane requests by default using structured API errors", async () => {
    let labelAttempts = 0;
    const records = await fetchPlaneTaskAndCommentSyncRecords(config, {
      async listProjectLabels() {
        labelAttempts += 1;
        if (labelAttempts === 1) {
          throw new PlaneApiError({
            status: 429,
            statusText: "Too Many Requests",
            body: "rate limited",
            retryAfterMs: 0,
          });
        }

        return [{ id: "label-1", name: "repo:crs" }];
      },
      async listProjectStates() {
        return [{ id: "state-1", name: "Development" }];
      },
      async listWorkItems() {
        return [
          {
            id: "issue-1",
            name: "Task",
            state: "state-1",
            labels: ["label-1"],
            sequence_id: 1,
            updated_at: "2026-06-19T12:00:00.000Z",
          },
        ];
      },
      async listWorkItemComments() {
        return [];
      },
    });

    expect(labelAttempts).toBe(2);
    expect(records.tasks.map((task) => task.externalTaskId)).toEqual(["issue-1"]);
    expect(records.warnings).toEqual([]);
  });

  it("does not retry non-retryable Plane API client errors", async () => {
    let labelAttempts = 0;

    await expect(
      fetchPlaneTaskAndCommentSyncRecords(
        config,
        {
          async listProjectLabels() {
            labelAttempts += 1;
            throw new PlaneApiError({
              status: 401,
              statusText: "Unauthorized",
              body: "bad token",
            });
          },
          async listProjectStates() {
            return [{ id: "state-1", name: "Development" }];
          },
          async listWorkItems() {
            return [];
          },
          async listWorkItemComments() {
            return [];
          },
        },
        { retryAttempts: 3, retryDelayMs: 0 },
      ),
    ).rejects.toMatchObject({
      name: "PlaneApiError",
      status: 401,
    } satisfies Partial<PlaneApiError>);

    expect(labelAttempts).toBe(1);
  });

  it("waits for positive 503 retry metadata before retrying", async () => {
    vi.useFakeTimers();

    let labelAttempts = 0;
    const syncPromise = fetchPlaneTaskAndCommentSyncRecords(
      config,
      {
        async listProjectLabels() {
          labelAttempts += 1;
          if (labelAttempts === 1) {
            throw new PlaneApiError({
              status: 503,
              statusText: "Service Unavailable",
              body: "temporarily unavailable",
              retryAfterMs: 250,
            });
          }

          return [{ id: "label-1", name: "repo:crs" }];
        },
        async listProjectStates() {
          return [{ id: "state-1", name: "Development" }];
        },
        async listWorkItems() {
          return [
            {
              id: "issue-1",
              name: "Task",
              state: "state-1",
              labels: ["label-1"],
              sequence_id: 1,
              updated_at: "2026-06-19T12:00:00.000Z",
            },
          ];
        },
        async listWorkItemComments() {
          return [];
        },
      },
      { retryAttempts: 2, retryDelayMs: 0 },
    );

    await Promise.resolve();
    expect(labelAttempts).toBe(1);

    await vi.advanceTimersByTimeAsync(249);
    expect(labelAttempts).toBe(1);

    await vi.advanceTimersByTimeAsync(1);
    const records = await syncPromise;

    expect(labelAttempts).toBe(2);
    expect(records.tasks.map((task) => task.externalTaskId)).toEqual(["issue-1"]);
    expect(records.warnings).toEqual([]);
  });

  it("retries comment fetch before reporting a warning", async () => {
    let commentAttempts = 0;
    const records = await fetchPlaneTaskAndCommentSyncRecords(
      config,
      {
        async listProjectLabels() {
          return [{ id: "label-1", name: "repo:crs" }];
        },
        async listProjectStates() {
          return [{ id: "state-1", name: "Development" }];
        },
        async listWorkItems() {
          return [
            {
              id: "issue-1",
              name: "Task",
              state: "state-1",
              labels: ["label-1"],
              sequence_id: 1,
              updated_at: "2026-06-19T12:00:00.000Z",
            },
          ];
        },
        async listWorkItemComments() {
          commentAttempts += 1;
          throw new Error(`comments down ${commentAttempts}`);
        },
      },
      { retryAttempts: 3, retryDelayMs: 0 },
    );

    expect(commentAttempts).toBe(3);
    expect(records.comments).toEqual([]);
    expect(records.warnings).toEqual([
      {
        type: "comment_fetch_failed",
        externalTaskId: "issue-1",
        message: "comments down 3",
      },
    ]);
  });
});
