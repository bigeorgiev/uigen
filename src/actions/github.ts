"use server";

import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createGitHubService, GitHubRepo } from "@/lib/github";
import { VirtualFileSystem } from "@/lib/file-system";
import { revalidatePath } from "next/cache";

export interface GitHubActionResult {
  success: boolean;
  error?: string;
  data?: any;
}

/**
 * Create a new GitHub repository and link it to a project
 */
export async function createAndLinkRepository(
  projectId: string,
  repoName: string,
  isPrivate: boolean = false
): Promise<GitHubActionResult> {
  try {
    const session = await getSession();
    if (!session) {
      return { success: false, error: "Not authenticated" };
    }

    // Get user with GitHub access token
    const user = await prisma.user.findUnique({
      where: { id: session.userId },
      select: { githubAccessToken: true, githubUsername: true },
    });

    if (!user?.githubAccessToken) {
      return {
        success: false,
        error: "GitHub account not connected. Please sign in with GitHub.",
      };
    }

    // Get project
    const project = await prisma.project.findUnique({
      where: { id: projectId, userId: session.userId },
    });

    if (!project) {
      return { success: false, error: "Project not found" };
    }

    // Create GitHub repository
    const github = createGitHubService(user.githubAccessToken);
    const repo = await github.createRepository(
      repoName,
      `UIGen project: ${project.name}`,
      isPrivate
    );

    // Update project with GitHub repo info
    await prisma.project.update({
      where: { id: projectId },
      data: {
        githubRepoName: repo.name,
        githubRepoOwner: repo.owner.login,
        githubRepoId: String(repo.id),
      },
    });

    revalidatePath(`/${projectId}`);
    return { success: true, data: repo };
  } catch (error: any) {
    console.error("Create and link repository error:", error);
    return {
      success: false,
      error: error.message || "Failed to create repository",
    };
  }
}

/**
 * Link an existing GitHub repository to a project
 */
export async function linkExistingRepository(
  projectId: string,
  owner: string,
  repoName: string
): Promise<GitHubActionResult> {
  try {
    const session = await getSession();
    if (!session) {
      return { success: false, error: "Not authenticated" };
    }

    // Get user with GitHub access token
    const user = await prisma.user.findUnique({
      where: { id: session.userId },
      select: { githubAccessToken: true },
    });

    if (!user?.githubAccessToken) {
      return {
        success: false,
        error: "GitHub account not connected",
      };
    }

    // Verify repository access
    const github = createGitHubService(user.githubAccessToken);
    const hasAccess = await github.hasRepositoryAccess(owner, repoName);

    if (!hasAccess) {
      return {
        success: false,
        error: "Repository not found or you don't have access",
      };
    }

    // Get repository info
    const repo = await github.getRepository(owner, repoName);

    // Update project
    await prisma.project.update({
      where: { id: projectId, userId: session.userId },
      data: {
        githubRepoName: repo.name,
        githubRepoOwner: repo.owner.login,
        githubRepoId: String(repo.id),
      },
    });

    revalidatePath(`/${projectId}`);
    return { success: true, data: repo };
  } catch (error: any) {
    console.error("Link existing repository error:", error);
    return {
      success: false,
      error: error.message || "Failed to link repository",
    };
  }
}

/**
 * Push project files to linked GitHub repository
 */
export async function pushToGitHub(
  projectId: string,
  commitMessage?: string
): Promise<GitHubActionResult> {
  try {
    const session = await getSession();
    if (!session) {
      return { success: false, error: "Not authenticated" };
    }

    // Get user with GitHub access token
    const user = await prisma.user.findUnique({
      where: { id: session.userId },
      select: { githubAccessToken: true },
    });

    if (!user?.githubAccessToken) {
      return {
        success: false,
        error: "GitHub account not connected",
      };
    }

    // Get project with GitHub info
    const project = await prisma.project.findUnique({
      where: { id: projectId, userId: session.userId },
    });

    if (!project) {
      return { success: false, error: "Project not found" };
    }

    if (!project.githubRepoOwner || !project.githubRepoName) {
      return {
        success: false,
        error: "Project not linked to a GitHub repository",
      };
    }

    // Deserialize virtual file system
    const vfsData = JSON.parse(project.data || "{}");
    const vfs = new VirtualFileSystem();
    Object.entries(vfsData).forEach(([path, node]: [string, any]) => {
      if (node.type === "file" && node.content) {
        vfs.createFile(path, node.content);
      }
    });

    // Push to GitHub
    const github = createGitHubService(user.githubAccessToken);
    const result = await github.pushToRepository(
      project.githubRepoOwner,
      project.githubRepoName,
      vfs,
      commitMessage || `Update from UIGen - ${new Date().toLocaleString()}`
    );

    // Update lastSyncedAt
    await prisma.project.update({
      where: { id: projectId },
      data: { lastSyncedAt: new Date() },
    });

    revalidatePath(`/${projectId}`);
    return { success: true, data: result };
  } catch (error: any) {
    console.error("Push to GitHub error:", error);
    return {
      success: false,
      error: error.message || "Failed to push to GitHub",
    };
  }
}

/**
 * Pull files from linked GitHub repository
 */
export async function pullFromGitHub(
  projectId: string
): Promise<GitHubActionResult> {
  try {
    const session = await getSession();
    if (!session) {
      return { success: false, error: "Not authenticated" };
    }

    // Get user with GitHub access token
    const user = await prisma.user.findUnique({
      where: { id: session.userId },
      select: { githubAccessToken: true },
    });

    if (!user?.githubAccessToken) {
      return {
        success: false,
        error: "GitHub account not connected",
      };
    }

    // Get project with GitHub info
    const project = await prisma.project.findUnique({
      where: { id: projectId, userId: session.userId },
    });

    if (!project) {
      return { success: false, error: "Project not found" };
    }

    if (!project.githubRepoOwner || !project.githubRepoName) {
      return {
        success: false,
        error: "Project not linked to a GitHub repository",
      };
    }

    // Pull from GitHub
    const github = createGitHubService(user.githubAccessToken);
    const files = await github.pullFromRepository(
      project.githubRepoOwner,
      project.githubRepoName
    );

    // Create new VFS with pulled files
    const vfs = new VirtualFileSystem();
    Object.entries(files).forEach(([path, content]) => {
      vfs.createFile(path, content);
    });

    // Serialize and update project
    const serialized = vfs.serialize();
    await prisma.project.update({
      where: { id: projectId },
      data: {
        data: JSON.stringify(serialized),
        lastSyncedAt: new Date(),
      },
    });

    revalidatePath(`/${projectId}`);
    return { success: true, data: { filesCount: Object.keys(files).length } };
  } catch (error: any) {
    console.error("Pull from GitHub error:", error);
    return {
      success: false,
      error: error.message || "Failed to pull from GitHub",
    };
  }
}

/**
 * Unlink GitHub repository from project
 */
export async function unlinkRepository(
  projectId: string
): Promise<GitHubActionResult> {
  try {
    const session = await getSession();
    if (!session) {
      return { success: false, error: "Not authenticated" };
    }

    await prisma.project.update({
      where: { id: projectId, userId: session.userId },
      data: {
        githubRepoName: null,
        githubRepoOwner: null,
        githubRepoId: null,
        lastSyncedAt: null,
      },
    });

    revalidatePath(`/${projectId}`);
    return { success: true };
  } catch (error: any) {
    console.error("Unlink repository error:", error);
    return {
      success: false,
      error: error.message || "Failed to unlink repository",
    };
  }
}

/**
 * List user's GitHub repositories
 */
export async function listGitHubRepositories(): Promise<GitHubActionResult> {
  try {
    const session = await getSession();
    if (!session) {
      return { success: false, error: "Not authenticated" };
    }

    const user = await prisma.user.findUnique({
      where: { id: session.userId },
      select: { githubAccessToken: true },
    });

    if (!user?.githubAccessToken) {
      return {
        success: false,
        error: "GitHub account not connected",
      };
    }

    const github = createGitHubService(user.githubAccessToken);
    const repos = await github.listRepositories();

    return { success: true, data: repos };
  } catch (error: any) {
    console.error("List repositories error:", error);
    return {
      success: false,
      error: error.message || "Failed to list repositories",
    };
  }
}
