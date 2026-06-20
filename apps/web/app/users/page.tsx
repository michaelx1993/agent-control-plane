import {
  insertUserAuditEvent,
  listUsers,
  upsertOperatorUser,
  withDatabasePool,
  withTransaction,
} from "@agent-control-plane/db";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  canManageProjectSettings,
  getOperatorContext,
  projectSettingsPermissionMessage,
} from "../../src/operator";

export const dynamic = "force-dynamic";

interface UsersPageProps {
  searchParams?: Promise<{
    limit?: string;
  }>;
}

export default async function UsersPage(props: UsersPageProps) {
  const searchParams = await props.searchParams;
  const limit = parseLimit(searchParams?.limit);
  const operator = getOperatorContext();
  const canManageUsers = canManageProjectSettings(operator);
  const users = await withDatabasePool((pool) => listUsers(pool, { limit }));

  async function upsertUserAction(formData: FormData) {
    "use server";
    const operator = getOperatorContext();
    if (!canManageProjectSettings(operator)) {
      throw new Error(projectSettingsPermissionMessage());
    }

    const name = requiredString(formData, "name");
    const userId = optionalString(formData, "userId");
    const email = optionalString(formData, "email");
    const user = await withDatabasePool((pool) =>
      withTransaction(pool, async (client) => {
        const user = await upsertOperatorUser(client, {
          ...(userId ? { userId } : {}),
          externalProvider: optionalString(formData, "externalProvider") ?? "local",
          externalUserId: optionalString(formData, "externalUserId") ?? name,
          name,
          ...(email ? { email } : {}),
        });
        await insertUserAuditEvent(client, {
          userId: user.id,
          action: "user.upsert",
          message: "Operator user upserted from user management page.",
          actor: operator,
        });
        return user;
      }),
    );

    redirect(`/users?limit=${limit}&updated=${user.id}`);
  }

  return (
    <main>
      <div className="shell">
        <header className="topbar">
          <div>
            <p className="subtle">
              <Link href="/">Dashboard</Link> / Users
            </p>
            <h1>用户管理</h1>
            <p className="subtle">
              查看当前数据库中的 operator users。写入来源为登录时的 DB-backed operator upsert。
            </p>
          </div>
          <Link className="button secondary" href="/session">
            当前 Session
          </Link>
        </header>

        <section className="grid">
          <article className="panel">
            <h2>用户数</h2>
            <p className="metric">{users.length}</p>
            <p className="subtle">当前查询返回的 users。</p>
          </article>

          <article className="panel wide">
            <h2>筛选</h2>
            <form className="filters" action="/users">
              <label>
                <span>Limit</span>
                <input name="limit" type="number" min="1" max="100" defaultValue={String(limit)} />
              </label>
              <button type="submit">刷新用户</button>
            </form>
          </article>

          <article className="panel full">
            <h2>创建 / 更新用户</h2>
            {!canManageUsers ? (
              <p className="form-error">{projectSettingsPermissionMessage()}</p>
            ) : null}
            <form action={upsertUserAction} className="create-settings-form">
              <input name="userId" placeholder="optional user uuid" />
              <input name="externalProvider" defaultValue="local" />
              <input name="externalUserId" placeholder="external user id" />
              <input name="name" placeholder="operator name" />
              <input name="email" placeholder="email" />
              <button disabled={!canManageUsers} type="submit">
                保存用户
              </button>
            </form>
          </article>

          <article className="panel full">
            <h2>Users</h2>
            <div className="table-list">
              <div className="settings-row users-row">
                <strong>Name</strong>
                <strong>External</strong>
                <strong>Email</strong>
                <strong>Updated</strong>
                <strong>ID</strong>
              </div>
              {users.map((user) => (
                <div className="settings-row users-row" key={user.id}>
                  <span>{user.name}</span>
                  <span>
                    {user.externalProvider}:{user.externalUserId}
                  </span>
                  <span>{user.email ?? "n/a"}</span>
                  <span>{user.updatedAt?.toISOString() ?? "n/a"}</span>
                  <code>{user.id}</code>
                </div>
              ))}
              {users.length === 0 ? <p className="subtle">暂无用户。</p> : null}
            </div>
          </article>
        </section>
      </div>
    </main>
  );
}

function parseLimit(value?: string): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 100) : 50;
}

function optionalString(formData: FormData, key: string): string | undefined {
  const value = String(formData.get(key) ?? "").trim();
  return value ? value : undefined;
}

function requiredString(formData: FormData, key: string): string {
  const value = optionalString(formData, key);
  if (!value) {
    throw new Error(`${key} is required`);
  }

  return value;
}
