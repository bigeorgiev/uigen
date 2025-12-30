import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const clientId = process.env.GITHUB_APP_CLIENT_ID;

  if (!clientId) {
    return NextResponse.json(
      { error: "GitHub App is not configured" },
      { status: 500 }
    );
  }

  // Get the origin for the callback URL
  const origin = request.nextUrl.origin;
  const redirectUri = `${origin}/api/auth/github-app/callback`;

  // Build GitHub App authorization URL
  const githubAuthUrl = new URL("https://github.com/login/oauth/authorize");
  githubAuthUrl.searchParams.set("client_id", clientId);
  githubAuthUrl.searchParams.set("redirect_uri", redirectUri);
  githubAuthUrl.searchParams.set("scope", "user:email");

  // Generate and store state parameter for CSRF protection
  const state = crypto.randomUUID();

  // Store state in cookie (will be verified in callback)
  const response = NextResponse.redirect(githubAuthUrl.toString());
  response.cookies.set("github_app_oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 10, // 10 minutes
    path: "/",
  });

  githubAuthUrl.searchParams.set("state", state);

  return NextResponse.redirect(githubAuthUrl.toString());
}
