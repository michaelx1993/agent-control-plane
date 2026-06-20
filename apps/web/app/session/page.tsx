import { cookies, headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { authorizeOperatorApiRequest, OPERATOR_SESSION_COOKIE } from "../../src/auth";
import { getDbBackedOperatorContext } from "../../src/operator";

export const dynamic = "force-dynamic";

interface SessionPageProps {
  searchParams?: Promise<{
    forbidden?: string;
  }>;
}

export default async function SessionPage(props: SessionPageProps) {
  const searchParams = await props.searchParams;
  const requestHeaders = await headers();
  const authorization = await authorizeOperatorApiRequest({ headers: requestHeaders });
  if (!authorization.ok) {
    redirect("/login?next=/session");
  }

  const operator = authorization.session ?? (await getDbBackedOperatorContext());
  const authType = authorization.session ? "session" : "token";
  const expiresAt = authorization.session ? new Date(authorization.session.expiresAt) : undefined;
  const expiresInSeconds = expiresAt
    ? Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000))
    : undefined;

  async function logoutAction() {
    "use server";

    const cookieStore = await cookies();
    cookieStore.delete(OPERATOR_SESSION_COOKIE);
    redirect("/login");
  }

  return (
    <main>
      <div className="shell">
        <header className="topbar">
          <div>
            <Link className="back-link" href="/">
              ← 控制台
            </Link>
            <h1>Operator Session</h1>
            <p className="subtle">查看当前认证方式、operator 身份和 signed session 过期时间。</p>
            <p className="subtle">
              <Link href="/users">查看用户管理</Link>
            </p>
          </div>
          <span className="badge">{authType}</span>
        </header>

        {searchParams?.forbidden ? (
          <p className="form-error">
            当前 operator roles 无权访问：<code>{searchParams.forbidden}</code>
          </p>
        ) : null}

        <section className="grid">
          <article className="panel">
            <h2>Operator</h2>
            <div className="list">
              <div className="row">
                <span className="subtle">Name</span>
                <strong>{operator.name}</strong>
              </div>
              <div className="row">
                <span className="subtle">User ID</span>
                <code>{operator.userId ?? "n/a"}</code>
              </div>
              <div className="row">
                <span className="subtle">Roles</span>
                <span>{operator.roles.length > 0 ? operator.roles.join(", ") : "none"}</span>
              </div>
            </div>
          </article>

          <article className="panel">
            <h2>Session</h2>
            <div className="list">
              <div className="row">
                <span className="subtle">Auth Type</span>
                <strong>{authType}</strong>
              </div>
              <div className="row">
                <span className="subtle">Expires At</span>
                <span>
                  {expiresAt ? expiresAt.toISOString() : "token auth / no browser session"}
                </span>
              </div>
              <div className="row">
                <span className="subtle">TTL</span>
                <span>{expiresInSeconds === undefined ? "n/a" : `${expiresInSeconds}s`}</span>
              </div>
            </div>
            <form action={logoutAction} className="inline-form session-actions">
              <button type="submit" disabled={authType !== "session"}>
                退出当前 session
              </button>
            </form>
          </article>
        </section>
      </div>
    </main>
  );
}
