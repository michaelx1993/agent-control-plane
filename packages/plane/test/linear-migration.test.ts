import { describe, expect, it } from "vitest";
import {
  buildLinearToPlaneMigrationPlan,
  parseLinearExport,
  runLinearToPlaneMigration,
  type RunLinearMigrationInput,
} from "../src/linear-migration";

const config = {
  baseUrl: "http://plane.test",
  apiKey: "token",
  workspaceSlug: "workspace",
  projectId: "project-id",
  projectSlug: "token",
};

describe("Linear migration", () => {
  it("parses Linear export arrays and nested label nodes", () => {
    const issues = parseLinearExport({
      data: {
        issues: {
          nodes: [
            {
              id: "issue-id",
              identifier: "TOK-1",
              title: "Build migration",
              state: { name: "Development" },
              labels: { nodes: [{ name: "repo:crs" }, { name: "Feature" }] },
              priority: 2,
              updatedAt: "2026-06-19T12:00:00.000Z",
            },
          ],
        },
      },
    });

    expect(issues).toEqual([
      {
        externalTaskId: "issue-id",
        identifier: "TOK-1",
        title: "Build migration",
        state: "Development",
        labels: ["repo:crs", "Feature"],
        priority: "high",
        syncCursor: "2026-06-19T12:00:00.000Z",
      },
    ]);
  });

  it("builds a dry-run plan and skips terminal states by default", async () => {
    const plan = await buildLinearToPlaneMigrationPlan(
      config,
      {
        issues: [
          {
            id: "linear-1",
            identifier: "TOK-1",
            title: "Active task",
            state: "Todo",
            labels: [{ name: "repo:crs" }, { name: "missing" }],
            url: "https://linear.app/test/issue/TOK-1",
          },
          {
            id: "linear-2",
            identifier: "TOK-2",
            title: "Finished task",
            state: "Done",
            labels: [],
          },
        ],
      },
      {
        async listProjectLabels() {
          return [{ id: "label-repo", name: "repo:crs" }];
        },
        async listProjectStates() {
          return [{ id: "state-todo", name: "Todo" }];
        },
      },
    );

    expect(plan.skipped).toEqual([{ identifier: "TOK-2", reason: "terminal state Done" }]);
    expect(plan.candidates).toHaveLength(1);
    expect(plan.candidates[0]?.stateId).toBe("state-todo");
    expect(plan.candidates[0]?.labelIds).toEqual(["label-repo"]);
    expect(plan.candidates[0]?.missingLabels).toEqual(["missing"]);
    expect(plan.candidates[0]?.descriptionHtml).toContain("https://linear.app/test/issue/TOK-1");
  });

  it("creates Plane work items only when apply is true", async () => {
    const createdNames: string[] = [];
    const input: RunLinearMigrationInput = {
      config,
      exportJson: {
        issues: [
          {
            id: "linear-1",
            identifier: "TOK-1",
            title: "Create me",
            state: "Todo",
            labels: ["Feature"],
          },
        ],
      },
      apply: true,
      client: {
        async listProjectLabels() {
          return [{ id: "label-feature", name: "Feature" }];
        },
        async listProjectStates() {
          return [{ id: "state-todo", name: "Todo" }];
        },
        async createWorkItem(_workspaceSlug, _projectId, input) {
          createdNames.push(input.name);
          return {
            id: "created-1",
            name: input.name,
          };
        },
      },
    };

    const result = await runLinearToPlaneMigration(input);

    expect(createdNames).toEqual(["Create me"]);
    expect(result).toMatchObject({
      apply: true,
      planned: 1,
      created: 1,
    });
    expect(result.createdWorkItems).toEqual([{ id: "created-1", name: "Create me" }]);
  });
});
