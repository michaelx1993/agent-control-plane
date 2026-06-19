import type { AgentRoleKey, Result, TaskState } from "../../shared/src/index";
import { controlPlaneError, err, ok, TASK_STATES } from "../../shared/src/index";

export const MAIN_STATE_CHAIN: readonly TaskState[] = [
  "Backlog",
  "Todo",
  "Development",
  "Code Review",
  "Human Review",
  "In Merge",
  "Merged",
  "Release Version",
  "Released",
  "Deployment",
  "Deployed",
  "Done",
] as const;

export const AUTOMATIC_STATES = [
  "Todo",
  "Development",
  "Code Review",
  "In Merge",
  "Release Version",
  "Deployment",
] as const satisfies readonly TaskState[];

export const HUMAN_STATES = [
  "Human Review",
  "Merged",
  "Released",
  "Deployed",
  "Done",
  "Canceled",
] as const satisfies readonly TaskState[];

export const TERMINAL_STATES = ["Done", "Canceled"] as const satisfies readonly TaskState[];

export const REWORK_TO_DEVELOPMENT_STATES = [
  "Code Review",
  "Human Review",
  "Merged",
  "Released",
  "Deployed",
] as const satisfies readonly TaskState[];

export const STATE_TO_ROLE: Partial<Record<TaskState, AgentRoleKey>> = {
  Todo: "intake",
  Development: "development",
  "Code Review": "code_review",
  "In Merge": "merge",
  "Release Version": "release",
  Deployment: "deployment",
} as const;

const taskStateSet = new Set<TaskState>(TASK_STATES);
const automaticStateSet = new Set<TaskState>(AUTOMATIC_STATES);
const humanStateSet = new Set<TaskState>(HUMAN_STATES);
const terminalStateSet = new Set<TaskState>(TERMINAL_STATES);
const reworkStateSet = new Set<TaskState>(REWORK_TO_DEVELOPMENT_STATES);

export interface TransitionValidation {
  from: TaskState;
  to: TaskState;
  kind: "main-chain" | "shortcut" | "rework";
}

export function isTaskState(value: string): value is TaskState {
  return taskStateSet.has(value as TaskState);
}

export function isAutomaticState(state: TaskState): boolean {
  return automaticStateSet.has(state);
}

export function isHumanState(state: TaskState): boolean {
  return humanStateSet.has(state);
}

export function isTerminalState(state: TaskState): boolean {
  return terminalStateSet.has(state);
}

export function validateTransition(from: TaskState, to: TaskState): Result<TransitionValidation> {
  if (isTerminalState(from)) {
    return err(
      controlPlaneError("STATE_TERMINAL", `Cannot transition from terminal state '${from}'.`, {
        from,
        to,
      }),
    );
  }

  if (to === "Done" || to === "Canceled") {
    return ok({ from, to, kind: "shortcut" });
  }

  if (to === "Development" && reworkStateSet.has(from)) {
    return ok({ from, to, kind: "rework" });
  }

  const fromIndex = MAIN_STATE_CHAIN.indexOf(from);
  const toIndex = MAIN_STATE_CHAIN.indexOf(to);
  if (fromIndex >= 0 && toIndex === fromIndex + 1) {
    return ok({ from, to, kind: "main-chain" });
  }

  return err(
    controlPlaneError(
      "STATE_TRANSITION_DENIED",
      `Transition '${from}' -> '${to}' is not allowed.`,
      { from, to },
    ),
  );
}

export function roleForState(state: TaskState): Result<AgentRoleKey> {
  const role = STATE_TO_ROLE[state];
  if (role === undefined) {
    return err(
      controlPlaneError("STATE_NOT_AUTOMATED", `State '${state}' is not routed to an agent role.`, {
        state,
      }),
    );
  }
  return ok(role);
}

export function nextMainState(state: TaskState): Result<TaskState> {
  const index = MAIN_STATE_CHAIN.indexOf(state);
  const next = MAIN_STATE_CHAIN[index + 1];
  if (index < 0 || next === undefined) {
    return err(
      controlPlaneError("STATE_HAS_NO_NEXT", `State '${state}' has no next main-chain state.`, {
        state,
      }),
    );
  }
  return ok(next);
}
