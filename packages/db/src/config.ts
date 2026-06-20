export const defaultDatabaseUrl = "postgresql://agent:agent@localhost:54329/agent_control_plane";

export function getDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  return env.DATABASE_URL?.trim() || defaultDatabaseUrl;
}
