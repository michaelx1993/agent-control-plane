import { NextResponse, type NextRequest } from "next/server";
import {
  authorizeOperatorApiRequest,
  canAccessOperatorPath,
  configuredOperatorRoles,
  isPublicApiPath,
  isPublicPagePath,
} from "./src/auth";
import {
  authorizeWorkerApiRequest,
  isWorkerApiPath,
  workerAuthErrorMessage,
} from "./src/worker-auth";

export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  if (isPublicApiPath(pathname) || isPublicPagePath(pathname)) {
    return NextResponse.next();
  }

  if (isWorkerApiPath(pathname)) {
    const workerAuthorization = authorizeWorkerApiRequest(request);
    if (workerAuthorization.ok) {
      return NextResponse.next();
    }

    return NextResponse.json(
      {
        error: workerAuthErrorMessage(workerAuthorization.reason),
        reason: workerAuthorization.reason,
      },
      { status: 401 },
    );
  }

  const authorization = await authorizeOperatorApiRequest(request);
  if (authorization.ok) {
    const roles = authorization.session?.roles ?? configuredOperatorRoles();
    const access = canAccessOperatorPath(pathname, request.method, roles);
    if (access.ok) {
      return NextResponse.next();
    }

    if (!pathname.startsWith("/api/")) {
      const forbiddenUrl = new URL("/session", request.url);
      forbiddenUrl.searchParams.set("forbidden", pathname);
      return NextResponse.redirect(forbiddenUrl);
    }

    return NextResponse.json(
      {
        error: "Operator role is not allowed for this path.",
        requiredRoles: access.requiredRoles ?? [],
      },
      { status: 403 },
    );
  }

  if (!pathname.startsWith("/api/")) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", request.nextUrl.pathname + request.nextUrl.search);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.json(
    {
      error: "Operator API token is required.",
      reason: authorization.reason,
    },
    { status: 401 },
  );
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
