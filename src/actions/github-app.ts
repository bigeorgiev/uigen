"use server";

import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createGitHubAppService } from "@/lib/github-app";
import { VirtualFileSystem } from "@/lib/file-system";
import { revalidatePath } from "next/cache";

export interface GitHubAppActionResult {
  success: boolean;
  error?: string;
  data?: any;
}

/**
 * Push project files to GitHub repository using GitHub App
 */
export async function pushToGitHubApp(
  projectId: string,
  commitMessage?: string
): Promise<GitHubAppActionResult> {
  try {
    const session = await getSession();
    if (!session) {
      return { success: false, error: "Not authenticated" };
    }

    // Get user with GitHub App installation ID
    const user = await prisma.user.findUnique({
      where: { id: session.userId },
      select: { githubAppInstallationId: true },
    });

    if (!user?.githubAppInstallationId) {
      return {
        success: false,
        error: "GitHub App not installed. Please install the app first.",
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

    // Push to GitHub using GitHub App
    const githubApp = createGitHubAppService(
      parseInt(user.githubAppInstallationId)
    );
    const result = await githubApp.pushToRepository(
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
    console.error("Push to GitHub App error:", error);
    return {
      success: false,
      error: error.message || "Failed to push to GitHub",
    };
  }
}

/**
 * Pull files from GitHub repository using GitHub App
 */
export async function pullFromGitHubApp(
  projectId: string
): Promise<GitHubAppActionResult> {
  try {
    const session = await getSession();
    if (!session) {
      return { success: false, error: "Not authenticated" };
    }

    // Get user with GitHub App installation ID
    const user = await prisma.user.findUnique({
      where: { id: session.userId },
      select: { githubAppInstallationId: true },
    });

    if (!user?.githubAppInstallationId) {
      return {
        success: false,
        error: "GitHub App not installed",
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

    // Pull from GitHub using GitHub App
    const githubApp = createGitHubAppService(
      parseInt(user.githubAppInstallationId)
    );
    const files = await githubApp.pullFromRepository(
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
    console.error("Pull from GitHub App error:", error);
    return {
      success: false,
      error: error.message || "Failed to pull from GitHub",
    };
  }
}

/**
 * List repositories accessible by the GitHub App installation
 */
export async function listGitHubAppRepositories(): Promise<GitHubAppActionResult> {
  try {
    const session = await getSession();
    if (!session) {
      return { success: false, error: "Not authenticated" };
    }

    const user = await prisma.user.findUnique({
      where: { id: session.userId },
      select: { githubAppInstallationId: true },
    });

    if (!user?.githubAppInstallationId) {
      return {
        success: false,
        error: "GitHub App not installed",
      };
    }

    const githubApp = createGitHubAppService(
      parseInt(user.githubAppInstallationId)
    );
    const repos = await githubApp.listRepositories();

    return { success: true, data: repos };
  } catch (error: any) {
    console.error("List GitHub App repositories error:", error);
    return {
      success: false,
      error: error.message || "Failed to list repositories",
    };
  }
}
