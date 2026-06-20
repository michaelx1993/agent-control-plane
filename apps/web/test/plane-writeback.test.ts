import { afterEach, describe, expect, it, vi } from "vitest";
import { maybeWritePlaneTaskState } from "../src/plane-writeback";

const config = {
  baseUrl: "http://plane",
  apiKey: "key",
  workspaceSlug: "workspace",
  projectId: "project",
  projectSlug: "token",
};

describe("maybeWritePlaneTaskState", () => {
  afterEach(() => {
    delete process.env.PLANE_WRITEBACK_ENABLED;
  });

  it("skips Plane writes when writeback is disabled", async () => {
    const writeStateChange = vi.fn();

    await expect(
      maybeWritePlaneTaskState(
        {
          externalTaskId: "issue-1",
          nextState: "Human Review",
          status: "Human Gate Updated",
          summary: "approved",
        },
        {
          loadConfig: () => config,
          writeStateChange,
        },
      ),
    ).resolves.toEqual({
      attempted: false,
      ok: true,
    });
    expect(writeStateChange).not.toHaveBeenCalled();
  });

  it("returns writeback failures without throwing", async () => {
    process.env.PLANE_WRITEBACK_ENABLED = "true";
    const writeStateChange = vi.fn().mockRejectedValue(new Error("Plane down"));

    await expect(
      maybeWritePlaneTaskState(
        {
          externalTaskId: "issue-1",
          nextState: "Development",
          status: "Rework Requested",
          summary: "fix it",
        },
        {
          loadConfig: () => config,
          writeStateChange,
        },
      ),
    ).resolves.toEqual({
      attempted: true,
      ok: false,
      error: "Plane down",
    });
  });
});
