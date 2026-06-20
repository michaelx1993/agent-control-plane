import { NextResponse } from "next/server";
import { authorizeOperatorApiRequest } from "../../../../src/auth";
import { getDbBackedOperatorContext } from "../../../../src/operator";

export async function GET(request: Request) {
  const authorization = await authorizeOperatorApiRequest(request);
  if (!authorization.ok) {
    return NextResponse.json(
      { error: "Operator session is required.", reason: authorization.reason },
      { status: 401 },
    );
  }

  const operator = authorization.session ?? (await getDbBackedOperatorContext());
  return NextResponse.json({
    operator,
    authType: authorization.session ? "session" : "token",
    session: authorization.session
      ? {
          expiresAt: new Date(authorization.session.expiresAt).toISOString(),
          expiresInSeconds: Math.max(
            0,
            Math.floor((authorization.session.expiresAt - Date.now()) / 1000),
          ),
        }
      : null,
  });
}
