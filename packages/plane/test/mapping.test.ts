import { describe, expect, it } from "vitest";
import { mapPlaneWorkItemToTask } from "../src/mapping";

describe("mapPlaneWorkItemToTask", () => {
  it("maps Plane label ids back to names so repo labels can route tasks", () => {
    const task = mapPlaneWorkItemToTask({
      projectIdentifier: "TOK",
      workItem: {
        id: "issue-1",
        name: "Sync smoke",
        state: "state-dev",
        labels: ["label-repo", "label-feature"],
        priority: "high",
        sequence_id: 3,
        updated_at: "2026-06-19T10:00:00Z",
      },
      labelsById: new Map([
        ["label-repo", { id: "label-repo", name: "repo:crs-src" }],
        ["label-feature", { id: "label-feature", name: "Feature" }],
      ]),
      statesById: new Map([["state-dev", { id: "state-dev", name: "Development" }]]),
    });

    expect(task).toMatchObject({
      externalTaskId: "issue-1",
      identifier: "TOK-3",
      title: "Sync smoke",
      state: "Development",
      labels: ["repo:crs-src", "Feature"],
      priority: 2,
      syncCursor: "2026-06-19T10:00:00Z",
    });
  });

  it("rejects unsupported Plane states before corrupting local workflow data", () => {
    expect(() =>
      mapPlaneWorkItemToTask({
        projectIdentifier: "TOK",
        workItem: {
          id: "issue-1",
          name: "Unknown",
          state: "state-custom",
          labels: [],
        },
        labelsById: new Map(),
        statesById: new Map([["state-custom", { id: "state-custom", name: "Custom QA" }]]),
      }),
    ).toThrow("unsupported workflow state");
  });
});
