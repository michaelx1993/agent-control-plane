import { describe, expect, it } from "vitest";
import {
  AUTOMATIC_STATES,
  HUMAN_STATES,
  isAutomaticState,
  isHumanState,
  isTerminalState,
  nextMainState,
  planWorkflowClosure,
  roleForState,
  TERMINAL_STATES,
  validateTransition,
} from "../src/index";

describe("state sets", () => {
  it("defines automatic, human, and terminal states from the PRD", () => {
    expect(AUTOMATIC_STATES).toEqual([
      "Todo",
      "Development",
      "Code Review",
      "In Merge",
      "Release Version",
      "Deployment",
    ]);
    expect(HUMAN_STATES).toContain("Human Review");
    expect(TERMINAL_STATES).toEqual(["Done", "Canceled"]);
    expect(isAutomaticState("Development")).toBe(true);
    expect(isHumanState("Done")).toBe(true);
    expect(isTerminalState("Canceled")).toBe(true);
  });
});

describe("validateTransition", () => {
  it("allows the main chain", () => {
    expect(validateTransition("Todo", "Development")).toEqual({
      ok: true,
      value: { from: "Todo", to: "Development", kind: "main-chain" },
    });
  });

  it("allows shortcuts from non-terminal states", () => {
    expect(validateTransition("Development", "Done")).toEqual({
      ok: true,
      value: { from: "Development", to: "Done", kind: "shortcut" },
    });
  });

  it("allows reviewer rework back to Development", () => {
    expect(validateTransition("Human Review", "Development")).toEqual({
      ok: true,
      value: { from: "Human Review", to: "Development", kind: "rework" },
    });
  });

  it("rejects transitions out of terminal states", () => {
    const result = validateTransition("Done", "Development");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("STATE_TERMINAL");
  });

  it("rejects skipped non-shortcut transitions", () => {
    const result = validateTransition("Todo", "Code Review");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("STATE_TRANSITION_DENIED");
  });
});

describe("roleForState", () => {
  it("routes automated states to agent roles", () => {
    expect(roleForState("Code Review")).toEqual({ ok: true, value: "code_review" });
    expect(roleForState("Release Version")).toEqual({ ok: true, value: "release" });
  });

  it("rejects human states", () => {
    const result = roleForState("Human Review");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("STATE_NOT_AUTOMATED");
  });
});

describe("nextMainState", () => {
  it("returns the next PRD chain state", () => {
    expect(nextMainState("In Merge")).toEqual({ ok: true, value: "Merged" });
  });
});

describe("planWorkflowClosure", () => {
  it("advances Development to Code Review after a completed OpenHands result", () => {
    expect(
      planWorkflowClosure({
        taskState: "Development",
        role: "development",
        openHandsResult: { status: "completed" },
      }),
    ).toEqual({
      ok: true,
      value: {
        allowedTransition: true,
        nextState: "Code Review",
        requiresHuman: false,
        reason: "Workflow can advance from 'Development' to 'Code Review'.",
        transition: { from: "Development", to: "Code Review", kind: "main-chain" },
      },
    });
  });

  it("advances successful Code Review to Human Review", () => {
    expect(
      planWorkflowClosure({
        taskState: "Code Review",
        role: "code_review",
        openHandsResult: { status: "completed" },
        unresolvedFeedback: [{ severity: "minor" }],
      }),
    ).toEqual({
      ok: true,
      value: {
        allowedTransition: true,
        nextState: "Human Review",
        requiresHuman: true,
        reason: "Workflow can advance from 'Code Review' to human-gated state 'Human Review'.",
        transition: { from: "Code Review", to: "Human Review", kind: "main-chain" },
      },
    });
  });

  it("returns Code Review with major or blocker feedback to Development", () => {
    expect(
      planWorkflowClosure({
        taskState: "Code Review",
        role: "code_review",
        openHandsResult: { status: "completed" },
        unresolvedFeedback: [{ severity: "major" }, { severity: "blocker" }],
      }),
    ).toEqual({
      ok: true,
      value: {
        allowedTransition: true,
        nextState: "Development",
        requiresHuman: false,
        reason: "Code review has unresolved major or blocker feedback; returning to Development.",
        transition: { from: "Code Review", to: "Development", kind: "rework" },
      },
    });
  });

  it("advances merge, release, and deployment closure states", () => {
    expect(
      planWorkflowClosure({
        taskState: "In Merge",
        role: "merge",
        openHandsResult: { status: "completed" },
      }),
    ).toMatchObject({ ok: true, value: { allowedTransition: true, nextState: "Merged" } });
    expect(
      planWorkflowClosure({
        taskState: "Release Version",
        role: "release",
        openHandsResult: { status: "completed" },
      }),
    ).toMatchObject({ ok: true, value: { allowedTransition: true, nextState: "Released" } });
    expect(
      planWorkflowClosure({
        taskState: "Deployment",
        role: "deployment",
        openHandsResult: { status: "completed" },
      }),
    ).toMatchObject({ ok: true, value: { allowedTransition: true, nextState: "Deployed" } });
  });

  it("does not auto-advance human-gated states", () => {
    expect(
      planWorkflowClosure({
        taskState: "Human Review",
        role: "code_review",
        openHandsResult: { status: "completed" },
      }),
    ).toEqual({
      ok: true,
      value: {
        allowedTransition: false,
        nextState: "Human Review",
        requiresHuman: true,
        reason: "State 'Human Review' requires human action before advancing.",
      },
    });
  });

  it("rejects illegal states", () => {
    const result = planWorkflowClosure({
      taskState: "Blocked",
      role: "development",
      openHandsResult: { status: "completed" },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("STATE_INVALID");
  });
});
