import { createHash } from "node:crypto";

export type UUID = string;
export type ISODateTime = string;

export const TASK_STATES = [
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
  "Blocked",
  "Done",
  "Canceled",
] as const;

export type TaskState = (typeof TASK_STATES)[number];

export const PROMPT_SCOPES = [
  "global",
  "team",
  "project",
  "repo",
  "role",
  "agent",
  "task",
  "runtime",
] as const;

export type PromptScope = (typeof PROMPT_SCOPES)[number];
export type PromptComponentStatus = "draft" | "active" | "archived";

export type AgentRoleKey =
  | "intake"
  | "development"
  | "code_review"
  | "merge"
  | "release"
  | "deployment";

export const FEEDBACK_SEVERITIES = ["info", "minor", "major", "blocker"] as const;

export type FeedbackSeverity = (typeof FEEDBACK_SEVERITIES)[number];

export interface ControlPlaneError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export type Result<T, E = ControlPlaneError> = { ok: true; value: T } | { ok: false; error: E };

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function err<E extends ControlPlaneError>(error: E): Result<never, E> {
  return { ok: false, error };
}

export function controlPlaneError(
  code: string,
  message: string,
  details?: Record<string, unknown>,
): ControlPlaneError {
  return details === undefined ? { code, message } : { code, message, details };
}

export function isOk<T, E>(result: Result<T, E>): result is { ok: true; value: T } {
  return result.ok;
}

export function isErr<T, E>(result: Result<T, E>): result is { ok: false; error: E } {
  return !result.ok;
}

export function nowIso(): ISODateTime {
  return new Date().toISOString();
}

export function toIsoDateTime(value: Date | string | number): Result<ISODateTime> {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return err(
      controlPlaneError("INVALID_DATETIME", "Value cannot be converted to an ISO datetime.", {
        value,
      }),
    );
  }
  return ok(date.toISOString());
}

export function isIsoDateTime(value: string): value is ISODateTime {
  const parsed = Date.parse(value);
  return !Number.isNaN(parsed) && new Date(parsed).toISOString() === value;
}

export function addSeconds(value: Date | string | number, seconds: number): Result<ISODateTime> {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return err(
      controlPlaneError("INVALID_DATETIME", "Value cannot be converted to an ISO datetime.", {
        value,
      }),
    );
  }
  return ok(new Date(date.getTime() + seconds * 1000).toISOString());
}

export function sha256Hex(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}
