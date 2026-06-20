export interface WorkerApiAuthEnv {
  ACP_WORKER_API_TOKEN?: string;
  [key: string]: string | undefined;
}

export interface WorkerApiAuthRequest {
  headers: Pick<Headers, "get">;
}

export interface WorkerApiAuthResult {
  ok: boolean;
  workerId?: string;
  reason?: "not_configured" | "missing_token" | "invalid_token" | "missing_worker_id";
}

export function isWorkerApiPath(pathname: string): boolean {
  return normalizePathname(pathname).startsWith("/api/worker/v1/");
}

export function isWorkerApiAuthRequired(env: WorkerApiAuthEnv = process.env): boolean {
  return Boolean(configuredWorkerToken(env));
}

export function authorizeWorkerApiRequest(
  request: WorkerApiAuthRequest,
  env: WorkerApiAuthEnv = process.env,
): WorkerApiAuthResult {
  const expected = configuredWorkerToken(env);
  if (!expected) {
    const workerId = extractWorkerId(request.headers);
    return {
      ok: true,
      reason: "not_configured",
      ...(workerId ? { workerId } : {}),
    };
  }

  const actual = extractWorkerToken(request.headers);
  if (!actual) {
    return { ok: false, reason: "missing_token" };
  }

  if (!timingSafeStringEqual(actual, expected)) {
    return { ok: false, reason: "invalid_token" };
  }

  const workerId = extractWorkerId(request.headers);
  if (!workerId) {
    return { ok: false, reason: "missing_worker_id" };
  }

  return { ok: true, workerId };
}

export function workerAuthErrorMessage(reason: WorkerApiAuthResult["reason"]): string {
  if (reason === "missing_worker_id") {
    return "Worker id is required.";
  }
  return "Worker API token is required.";
}

function extractWorkerToken(headers: Pick<Headers, "get">): string | undefined {
  const headerToken = normalizeToken(headers.get("x-acp-worker-token") ?? undefined);
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

function extractWorkerId(headers: Pick<Headers, "get">): string | undefined {
  return normalizeToken(headers.get("x-acp-worker-id") ?? undefined);
}

function configuredWorkerToken(env: WorkerApiAuthEnv): string | undefined {
  return normalizeToken(env.ACP_WORKER_API_TOKEN);
}

function normalizeToken(value: string | undefined): string | undefined {
  const token = value?.trim();
  return token ? token : undefined;
}

function normalizePathname(pathname: string): string {
  return pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
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
