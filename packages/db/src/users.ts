import type { DatabaseClient } from "./client.js";

export interface OperatorUserInput {
  userId?: string;
  externalProvider?: string;
  externalUserId?: string;
  name: string;
  email?: string;
}

export interface UserAuditActor {
  userId?: string;
  name: string;
  roles: string[];
}

export interface OperatorUserRecord {
  id: string;
  externalProvider: string;
  externalUserId: string;
  name: string;
  email?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

interface OperatorUserRow {
  id: string;
  external_provider: string;
  external_user_id: string;
  name: string;
  email: string | null;
  created_at?: Date;
  updated_at?: Date;
}

export async function upsertOperatorUser(
  client: DatabaseClient,
  input: OperatorUserInput,
): Promise<OperatorUserRecord> {
  const externalProvider = input.externalProvider?.trim() || "local";
  const externalUserId = input.externalUserId?.trim() || input.name;
  const result = await client.query<OperatorUserRow>(
    `
      insert into users (
        id,
        external_provider,
        external_user_id,
        name,
        email,
        created_at,
        updated_at
      )
      values (
        coalesce($1::uuid, gen_random_uuid()),
        $2,
        $3,
        $4,
        $5,
        now(),
        now()
      )
      on conflict (external_provider, external_user_id) do update set
        name = excluded.name,
        email = excluded.email,
        updated_at = now()
      returning id, external_provider, external_user_id, name, email
    `,
    [input.userId ?? null, externalProvider, externalUserId, input.name, input.email ?? null],
  );

  const row = result.rows[0];
  if (!row) {
    throw new Error("Failed to upsert operator user.");
  }

  return {
    id: row.id,
    externalProvider: row.external_provider,
    externalUserId: row.external_user_id,
    name: row.name,
    ...(row.email ? { email: row.email } : {}),
    ...(row.created_at ? { createdAt: row.created_at } : {}),
    ...(row.updated_at ? { updatedAt: row.updated_at } : {}),
  };
}

export async function listUsers(
  client: DatabaseClient,
  options: { limit?: number } = {},
): Promise<OperatorUserRecord[]> {
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 100);
  const result = await client.query<OperatorUserRow>(
    `
      select
        id,
        external_provider,
        external_user_id,
        name,
        email,
        created_at,
        updated_at
      from users
      order by updated_at desc, created_at desc
      limit $1
    `,
    [limit],
  );

  return result.rows.map((row) => ({
    id: row.id,
    externalProvider: row.external_provider,
    externalUserId: row.external_user_id,
    name: row.name,
    ...(row.email ? { email: row.email } : {}),
    ...(row.created_at ? { createdAt: row.created_at } : {}),
    ...(row.updated_at ? { updatedAt: row.updated_at } : {}),
  }));
}

export async function insertUserAuditEvent(
  client: DatabaseClient,
  input: {
    userId: string;
    action: string;
    message: string;
    actor?: UserAuditActor;
  },
): Promise<void> {
  await client.query(
    `
      insert into audit_events (
        id,
        actor_user_id,
        action,
        entity_type,
        entity_id,
        message,
        payload,
        created_at
      )
      values (
        gen_random_uuid(),
        $1,
        $2,
        'user',
        $3,
        $4,
        jsonb_build_object(
          'actor', jsonb_build_object(
            'name', $5::text,
            'roles', to_jsonb($6::text[])
          )
        ),
        now()
      )
    `,
    [
      input.actor?.userId ?? null,
      input.action,
      input.userId,
      input.message,
      input.actor?.name ?? "unknown",
      input.actor?.roles ?? [],
    ],
  );
}
