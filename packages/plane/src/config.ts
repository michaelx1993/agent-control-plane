export interface PlaneConfig {
  baseUrl: string;
  apiKey: string;
  workspaceSlug: string;
  projectId: string;
  projectSlug: string;
}

export function loadPlaneConfig(env: NodeJS.ProcessEnv = process.env): PlaneConfig {
  return {
    baseUrl: requireEnv(env, "PLANE_BASE_URL").replace(/\/+$/, ""),
    apiKey: requireEnv(env, "PLANE_API_KEY"),
    workspaceSlug: requireEnv(env, "PLANE_WORKSPACE_SLUG"),
    projectId: requireEnv(env, "PLANE_PROJECT_ID"),
    projectSlug: env.PLANE_PROJECT_SLUG?.trim() || "token",
  };
}

function requireEnv(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();

  if (!value) {
    throw new Error(`${name} is required`);
  }

  return value;
}
