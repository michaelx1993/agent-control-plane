import { describe, expect, it } from "vitest";

import { isDispatchableTaskCandidate } from "./query.js";

describe("isDispatchableTaskCandidate", () => {
  it("rejects tasks without a repository", () => {
    expect(
      isDispatchableTaskCandidate({
        repositoryId: null,
        state: "Development",
        repository: null,
        runs: [],
      }),
    ).toBe(false);
  });

  it("accepts dispatchable tasks with an active repository and no live run", () => {
    expect(
      isDispatchableTaskCandidate({
        repositoryId: "f7130d60-4fd2-4d6f-8f22-31c828a93e17",
        state: "Development",
        repository: { status: "active" },
        runs: [],
      }),
    ).toBe(true);
  });
});
