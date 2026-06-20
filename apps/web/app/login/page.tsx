import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  createOperatorSessionToken,
  OPERATOR_SESSION_COOKIE,
  operatorSessionTtlSeconds,
} from "../../src/auth";
import {
  getDbBackedOperatorContext,
  isOperatorLoginConfigured,
  verifyOperatorPassword,
} from "../../src/operator";

interface LoginPageProps {
  searchParams?: Promise<{
    error?: string;
    next?: string;
  }>;
}

export default async function LoginPage(props: LoginPageProps) {
  const searchParams = await props.searchParams;
  const error = searchParams?.error;
  const next = normalizeNextPath(searchParams?.next);
  const loginConfigured = isOperatorLoginConfigured();

  async function loginAction(formData: FormData) {
    "use server";

    const password = String(formData.get("password") ?? "");
    const target = normalizeNextPath(String(formData.get("next") ?? ""));
    const secret = process.env.ACP_OPERATOR_SESSION_SECRET?.trim();

    if (!secret || !verifyOperatorPassword(password)) {
      redirect(`/login?error=invalid&next=${encodeURIComponent(target)}`);
    }

    const operator = await getDbBackedOperatorContext();
    const ttlSeconds = operatorSessionTtlSeconds();
    const token = await createOperatorSessionToken(operator, secret, ttlSeconds);
    const cookieStore = await cookies();
    cookieStore.set(OPERATOR_SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.ACP_ENV === "production",
      path: "/",
      maxAge: ttlSeconds,
    });

    redirect(target);
  }

  return (
    <main className="login-shell">
      <form action={loginAction} className="login-panel">
        <div>
          <p className="eyebrow">Agent Control Plane</p>
          <h1>Operator 登录</h1>
          <p className="subtle">使用本机配置的 operator password 创建 signed session。</p>
        </div>

        {!loginConfigured ? (
          <p className="form-error">尚未配置 ACP_OPERATOR_LOGIN_PASSWORD，登录入口不可用。</p>
        ) : null}
        {error ? <p className="form-error">登录失败，请检查密码或 session secret。</p> : null}

        <input type="hidden" name="next" value={next} />
        <label>
          <span>Password</span>
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            disabled={!loginConfigured}
            required
          />
        </label>
        <button type="submit" disabled={!loginConfigured}>
          登录
        </button>
      </form>
    </main>
  );
}

function normalizeNextPath(value: string | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return "/";
  }

  return value;
}
