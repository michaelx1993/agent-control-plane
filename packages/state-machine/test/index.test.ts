import { describe, expect, it } from "vitest";
import {
  AUTOMATIC_STATES,
  HUMAN_STATES,
  isAutomaticState,
  isHumanState,
  isTerminalState,
  nextMainState,
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
