import { describe, expect, it, vi } from "vitest";
import { writePlaneRunCompletion, writePlaneTaskStateChange } from "../src/writeback";

describe("writePlaneRunCompletion", () => {
  it("patches Plane state and posts a completion comment", async () => {
    const client = {
      listProjectStates: vi.fn().mockResolvedValue([{ id: "state-review", name: "Code Review" }]),
      updateWorkItemState: vi.fn().mockResolvedValue(undefined),
      createWorkItemComment: vi.fn().mockResolvedValue(undefined),
    };

    await writePlaneRunCompletion(
      {
        baseUrl: "http://plane",
        apiKey: "key",
        workspaceSlug: "aiworkspace",
        projectId: "project-1",
        projectSlug: "token",
      },
      {
        externalTaskId: "issue-1",
        nextState: "Code Review",
        summary: "Done <safe>",
      },
      client,
    );

    expect(client.updateWorkItemState).toHaveBeenCalledWith(
      "aiworkspace",
      "project-1",
      "issue-1",
      "state-review",
    );
    expect(client.createWorkItemComment).toHaveBeenCalledWith(
      "aiworkspace",
      "project-1",
      "issue-1",
      expect.stringContaining("Done &lt;safe&gt;"),
    );
  });

  it("fails clearly when the Plane state is missing", async () => {
    await expect(
      writePlaneRunCompletion(
        {
          baseUrl: "http://plane",
          apiKey: "key",
          workspaceSlug: "aiworkspace",
          projectId: "project-1",
          projectSlug: "token",
        },
        {
          externalTaskId: "issue-1",
          nextState: "Code Review",
          summary: "Done",
        },
        {
          listProjectStates: vi.fn().mockResolvedValue([]),
          updateWorkItemState: vi.fn(),
          createWorkItemComment: vi.fn(),
        },
      ),
    ).rejects.toThrow("Plane state not found");
  });
});

describe("writePlaneTaskStateChange", () => {
  it("patches Plane state and posts an operator status comment", async () => {
    const client = {
      listProjectStates: vi.fn().mockResolvedValue([{ id: "state-dev", name: "Development" }]),
      updateWorkItemState: vi.fn().mockResolvedValue(undefined),
      createWorkItemComment: vi.fn().mockResolvedValue(undefined),
    };

    await writePlaneTaskStateChange(
      {
        baseUrl: "http://plane",
        apiKey: "key",
        workspaceSlug: "aiworkspace",
        projectId: "project-1",
        projectSlug: "token",
      },
      {
        externalTaskId: "issue-1",
        nextState: "Development",
        status: "Rework Requested",
        summary: "Fix <bug>",
      },
      client,
    );

    expect(client.updateWorkItemState).toHaveBeenCalledWith(
      "aiworkspace",
      "project-1",
      "issue-1",
      "state-dev",
    );
    expect(client.createWorkItemComment).toHaveBeenCalledWith(
      "aiworkspace",
      "project-1",
      "issue-1",
      expect.stringContaining("Rework Requested"),
    );
    expect(client.createWorkItemComment).toHaveBeenCalledWith(
      "aiworkspace",
      "project-1",
      "issue-1",
      expect.stringContaining("Fix &lt;bug&gt;"),
    );
  });
});
