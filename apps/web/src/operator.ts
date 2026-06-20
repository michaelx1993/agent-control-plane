import { upsertOperatorUser, withDatabasePool } from "@agent-control-plane/db";

export interface OperatorContext {
  userId?: string;
  name: string;
  roles: string[];
}

const promptRequestRoles = new Set(["owner", "admin", "prompt_admin", "prompt_editor"]);
const promptApprovalRoles = new Set(["owner", "admin", "prompt_admin"]);
const monitoringSettingsRoles = new Set(["owner", "admin"]);
const projectSettingsRoles = new Set(["owner", "admin"]);

export function getOperatorContext(): OperatorContext {
  return getConfiguredOperatorContext();
}

export function getConfiguredOperatorContext(): OperatorContext {
  const roles = parseRoles(process.env.ACP_OPERATOR_ROLES);

  return {
    ...(process.env.ACP_OPERATOR_USER_ID?.trim()
      ? { userId: process.env.ACP_OPERATOR_USER_ID.trim() }
      : {}),
    name: process.env.ACP_OPERATOR_NAME?.trim() || "local-operator",
    roles,
  };
}

export async function getDbBackedOperatorContext(): Promise<OperatorContext> {
  const operator = getConfiguredOperatorContext();
  const user = await withDatabasePool((pool) =>
    upsertOperatorUser(pool, {
      ...(operator.userId ? { userId: operator.userId } : {}),
      externalProvider: "local",
      externalUserId: operator.name,
      name: operator.name,
    }),
  );

  return {
    ...operator,
    userId: user.id,
    name: user.name,
  };
}

export function isOperatorLoginConfigured(): boolean {
  return Boolean(process.env.ACP_OPERATOR_LOGIN_PASSWORD?.trim());
}

export function verifyOperatorPassword(password: string): boolean {
  const expected = process.env.ACP_OPERATOR_LOGIN_PASSWORD?.trim();
  if (!expected) {
    return false;
  }

  return timingSafeStringEqual(password, expected);
}

export function canRequestPromptBinding(operator: OperatorContext): boolean {
  return operator.roles.some((role) => promptRequestRoles.has(role));
}

export function canApprovePromptBinding(operator: OperatorContext): boolean {
  return operator.roles.some((role) => promptApprovalRoles.has(role));
}

export function canManageMonitoringSettings(operator: OperatorContext): boolean {
  return operator.roles.some((role) => monitoringSettingsRoles.has(role));
}

export function canManageProjectSettings(operator: OperatorContext): boolean {
  return operator.roles.some((role) => projectSettingsRoles.has(role));
}

export function promptBindingPermissionMessage(action: "request" | "approve"): string {
  if (action === "request") {
    return "Prompt binding request requires one of: owner, admin, prompt_admin, prompt_editor.";
  }

  return "Prompt binding approval requires one of: owner, admin, prompt_admin.";
}

export function monitoringSettingsPermissionMessage(): string {
  return "Monitoring threshold updates require one of: owner, admin.";
}

export function projectSettingsPermissionMessage(): string {
  return "Project settings updates require one of: owner, admin.";
}

function parseRoles(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((role) => role.trim())
    .filter(Boolean);
}

function timingSafeStringEqual(left: string, right: string): boolean {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  let diff = leftBytes.length ^ rightBytes.length;
  const maxLength = Math.max(leftBytes.length, rightBytes.length);

  for (let index = 0; index < maxLength; index += 1) {
    diff |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }

  return diff === 0;
}
