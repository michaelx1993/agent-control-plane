export interface OperatorApiAuthResult {
  ok: boolean;
  reason?: "not_configured" | "missing_token" | "invalid_token" | "invalid_session";
  session?: OperatorSessionPayload;
}

export interface OperatorApiAuthEnv {
  CONTROL_PLANE_API_TOKEN?: string;
  ACP_OPERATOR_API_TOKEN?: string;
  ACP_OPERATOR_SESSION_SECRET?: string;
  ACP_OPERATOR_SESSION_TTL_SECONDS?: string;
  ACP_OPERATOR_ROLES?: string;
  [key: string]: string | undefined;
}

export interface OperatorApiAuthRequest {
  headers: Pick<Headers, "get">;
}

export interface OperatorSessionPayload {
  userId?: string;
  name: string;
  roles: string[];
  expiresAt: number;
}

export interface OperatorPathAccessResult {
  ok: boolean;
  requiredRoles?: string[];
}

export const OPERATOR_SESSION_COOKIE = "acp_operator_session";

export function isOperatorApiAuthRequired(env: OperatorApiAuthEnv = process.env): boolean {
  return Boolean(configuredToken(env) || configuredSessionSecret(env));
}

export async function authorizeOperatorApiRequest(
  request: OperatorApiAuthRequest,
  env: OperatorApiAuthEnv = process.env,
): Promise<OperatorApiAuthResult> {
  const expected = configuredToken(env);
  const sessionSecret = configuredSessionSecret(env);
  if (!expected && !sessionSecret) {
    return { ok: true, reason: "not_configured" };
  }

  const actual = extractOperatorApiToken(request.headers);
  if (actual && expected) {
    return timingSafeStringEqual(actual, expected)
      ? { ok: true }
      : { ok: false, reason: "invalid_token" };
  }

  if (sessionSecret) {
    const sessionToken = extractCookieValue(request.headers, OPERATOR_SESSION_COOKIE);
    if (sessionToken) {
      const session = await verifyOperatorSessionToken(sessionToken, sessionSecret);
      return session ? { ok: true, session } : { ok: false, reason: "invalid_session" };
    }
  }

  return { ok: false, reason: "missing_token" };
}

export function isPublicApiPath(pathname: string): boolean {
  const normalizedPathname = normalizePathname(pathname);
  return (
    normalizedPathname === "/api/readiness" ||
    normalizedPathname === "/api/plane/webhook" ||
    normalizedPathname === "/api/auth/login" ||
    normalizedPathname === "/api/auth/logout"
  );
}

export function isPublicPagePath(pathname: string): boolean {
  const normalizedPathname = normalizePathname(pathname);
  return (
    normalizedPathname === "/login" ||
    normalizedPathname.startsWith("/_next/") ||
    normalizedPathname === "/favicon.ico"
  );
}

export function configuredOperatorRoles(env: OperatorApiAuthEnv = process.env): string[] {
  return parseRoles(env.ACP_OPERATOR_ROLES);
}

export function canAccessOperatorPath(
  pathname: string,
  method: string,
  roles: string[],
): OperatorPathAccessResult {
  if (hasAnyRole(roles, ["owner", "admin"])) {
    return { ok: true };
  }

  const normalizedPathname = normalizePathname(pathname);
  const normalizedMethod = method.toUpperCase();
  const requiredRoles = requiredRolesForPath(normalizedPathname, normalizedMethod);
  if (requiredRoles.length === 0 || hasAnyRole(roles, requiredRoles)) {
    return { ok: true };
  }

  return { ok: false, requiredRoles };
}

export function operatorSessionTtlSeconds(env: OperatorApiAuthEnv = process.env): number {
  const parsed = Number.parseInt(env.ACP_OPERATOR_SESSION_TTL_SECONDS ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 8 * 60 * 60;
}

export async function createOperatorSessionToken(
  payload: Omit<OperatorSessionPayload, "expiresAt">,
  secret: string,
  ttlSeconds = operatorSessionTtlSeconds(),
  now = new Date(),
): Promise<string> {
  const sessionPayload: OperatorSessionPayload = {
    ...payload,
    expiresAt: now.getTime() + ttlSeconds * 1000,
  };
  const encodedPayload = base64UrlEncode(JSON.stringify(sessionPayload));
  const signature = await sign(encodedPayload, secret);
  return `${encodedPayload}.${signature}`;
}

export async function verifyOperatorSessionToken(
  token: string,
  secret: string,
  now = new Date(),
): Promise<OperatorSessionPayload | undefined> {
  const [encodedPayload, signature] = token.split(".");
  if (!encodedPayload || !signature) {
    return undefined;
  }

  const expected = await sign(encodedPayload, secret);
  if (!timingSafeStringEqual(signature, expected)) {
    return undefined;
  }

  const parsed = parseSessionPayload(base64UrlDecode(encodedPayload));
  if (!parsed || parsed.expiresAt <= now.getTime()) {
    return undefined;
  }

  return parsed;
}

function extractOperatorApiToken(headers: Pick<Headers, "get">): string | undefined {
  const headerToken = normalizeToken(headers.get("x-acp-operator-token") ?? undefined);
  if (headerToken) {
    return headerToken;
  }

  const authorization = headers.get("authorization")?.trim();
  if (!authorization) {
    return undefined;
  }

  const [scheme, ...rest] = authorization.split(/\s+/);
  if (scheme?.toLowerCase() !== "bearer") {
    return undefined;
  }

  return normalizeToken(rest.join(" "));
}

function normalizeToken(value: string | undefined): string | undefined {
  const token = value?.trim();
  return token ? token : undefined;
}

function configuredToken(env: OperatorApiAuthEnv): string | undefined {
  return normalizeToken(env.ACP_OPERATOR_API_TOKEN) ?? normalizeToken(env.CONTROL_PLANE_API_TOKEN);
}

function configuredSessionSecret(env: OperatorApiAuthEnv): string | undefined {
  return normalizeToken(env.ACP_OPERATOR_SESSION_SECRET);
}

function normalizePathname(pathname: string): string {
  return pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
}

function requiredRolesForPath(pathname: string, method: string): string[] {
  if (pathname === "/" || pathname === "/session") {
    return [];
  }

  if (
    pathname === "/audit" ||
    pathname.startsWith("/tasks") ||
    pathname.startsWith("/runs") ||
    pathname.startsWith("/prompt-releases")
  ) {
    return [];
  }

  if (pathname === "/users" || pathname.startsWith("/api/users")) {
    return ["owner", "admin"];
  }

  if (pathname === "/settings") {
    return ["owner", "admin", "prompt_admin", "prompt_editor"];
  }

  if (pathname.startsWith("/prompt-components")) {
    return ["owner", "admin", "prompt_admin", "prompt_editor", "viewer"];
  }

  if (pathname === "/api/auth/session") {
    return [];
  }

  if (
    pathname === "/api/audit-events" ||
    pathname.startsWith("/api/runs") ||
    pathname.startsWith("/api/prompt-releases")
  ) {
    return [];
  }

  if (pathname.startsWith("/api/tasks")) {
    return method === "GET" ? [] : ["owner", "admin"];
  }

  if (pathname === "/api/monitoring/thresholds") {
    return method === "GET" ? [] : ["owner", "admin"];
  }

  if (pathname === "/api/settings") {
    return method === "GET"
      ? ["owner", "admin", "prompt_admin", "prompt_editor"]
      : ["owner", "admin"];
  }

  if (pathname.startsWith("/api/settings/")) {
    return ["owner", "admin"];
  }

  if (pathname === "/api/prompt-bindings") {
    return method === "GET"
      ? ["owner", "admin", "prompt_admin", "prompt_editor", "viewer"]
      : ["owner", "admin", "prompt_admin", "prompt_editor"];
  }

  if (pathname.startsWith("/api/prompt-bindings/")) {
    return ["owner", "admin", "prompt_admin"];
  }

  if (pathname === "/api/prompt-components") {
    return method === "GET"
      ? ["owner", "admin", "prompt_admin", "prompt_editor", "viewer"]
      : ["owner", "admin", "prompt_admin", "prompt_editor"];
  }

  if (pathname.startsWith("/api/prompt-components/")) {
    return method === "GET"
      ? ["owner", "admin", "prompt_admin", "prompt_editor", "viewer"]
      : ["owner", "admin", "prompt_admin", "prompt_editor"];
  }

  return [];
}

function hasAnyRole(actualRoles: string[], allowedRoles: string[]): boolean {
  return actualRoles.some((role) => allowedRoles.includes(role));
}

function parseRoles(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((role) => role.trim())
    .filter(Boolean);
}

function timingSafeStringEqual(left: string, right: string): boolean {
  const encoder = new TextEncoder();
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  let diff = leftBytes.length ^ rightBytes.length;
  const maxLength = Math.max(leftBytes.length, rightBytes.length);

  for (let index = 0; index < maxLength; index += 1) {
    diff |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }

  return diff === 0;
}

function extractCookieValue(headers: Pick<Headers, "get">, name: string): string | undefined {
  const cookieHeader = headers.get("cookie");
  if (!cookieHeader) {
    return undefined;
  }

  for (const cookie of cookieHeader.split(";")) {
    const [rawName, ...rawValue] = cookie.trim().split("=");
    if (rawName === name) {
      return normalizeToken(decodeURIComponent(rawValue.join("=")));
    }
  }

  return undefined;
}

async function sign(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return base64UrlEncodeBytes(new Uint8Array(signature));
}

function parseSessionPayload(value: string): OperatorSessionPayload | undefined {
  try {
    const parsed = JSON.parse(value) as Partial<OperatorSessionPayload>;
    if (
      typeof parsed.name !== "string" ||
      !Array.isArray(parsed.roles) ||
      !parsed.roles.every((role) => typeof role === "string") ||
      typeof parsed.expiresAt !== "number"
    ) {
      return undefined;
    }

    return {
      ...(typeof parsed.userId === "string" ? { userId: parsed.userId } : {}),
      name: parsed.name,
      roles: parsed.roles,
      expiresAt: parsed.expiresAt,
    };
  } catch {
    return undefined;
  }
}

function base64UrlEncode(value: string): string {
  return base64UrlEncodeBytes(new TextEncoder().encode(value));
}

function base64UrlEncodeBytes(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function base64UrlDecode(value: string): string {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return new TextDecoder().decode(bytes);
}
