import { NextRequest, NextResponse } from "next/server";
import { Octokit } from "octokit";
import prisma from "@/lib/prisma";
import { createSession } from "@/lib/auth";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const storedState = request.cookies.get("github_oauth_state")?.value;

  // Verify state parameter for CSRF protection
  if (!state || state !== storedState) {
    return NextResponse.redirect(
      new URL("/?error=invalid_state", request.url)
    );
  }

  if (!code) {
    return NextResponse.redirect(
      new URL("/?error=no_code", request.url)
    );
  }

  const clientId = process.env.GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return NextResponse.redirect(
      new URL("/?error=github_not_configured", request.url)
    );
  }

  try {
    // Exchange code for access token
    const tokenResponse = await fetch(
      "https://github.com/login/oauth/access_token",
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          client_id: clientId,
          client_secret: clientSecret,
          code,
        }),
      }
    );

    const tokenData = await tokenResponse.json();

    if (tokenData.error || !tokenData.access_token) {
      console.error("GitHub OAuth error:", tokenData);
      return NextResponse.redirect(
        new URL("/?error=token_exchange_failed", request.url)
      );
    }

    const accessToken = tokenData.access_token;

    // Get user information from GitHub
    const octokit = new Octokit({ auth: accessToken });
    const { data: githubUser } = await octokit.rest.users.getAuthenticated();

    // Get user's primary email
    const { data: emails } = await octokit.rest.users.listEmailsForAuthenticatedUser();
    const primaryEmail = emails.find((email) => email.primary)?.email;

    // Find or create user in database
    let user = await prisma.user.findUnique({
      where: { githubId: String(githubUser.id) },
    });

    if (!user) {
      // Create new user with GitHub info
      user = await prisma.user.create({
        data: {
          githubId: String(githubUser.id),
          githubUsername: githubUser.login,
          githubAccessToken: accessToken,
          githubAvatarUrl: githubUser.avatar_url,
          email: primaryEmail || null,
        },
      });
    } else {
      // Update existing user's token and info
      user = await prisma.user.update({
        where: { id: user.id },
        data: {
          githubAccessToken: accessToken,
          githubUsername: githubUser.login,
          githubAvatarUrl: githubUser.avatar_url,
          email: primaryEmail || user.email,
        },
      });
    }

    // Create session
    await createSession(
      user.id,
      user.email || user.githubUsername || "",
      user.githubUsername || undefined
    );

    // Clear state cookie and redirect to home
    const response = NextResponse.redirect(new URL("/", request.url));
    response.cookies.delete("github_oauth_state");

    return response;
  } catch (error) {
    console.error("GitHub OAuth callback error:", error);
    return NextResponse.redirect(
      new URL("/?error=authentication_failed", request.url)
    );
  }
}
