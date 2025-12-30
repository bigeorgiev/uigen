import "server-only";
import { App } from "@octokit/app";
import { readFileSync } from "fs";
import { join } from "path";
import { VirtualFileSystem } from "./file-system";

let appInstance: App | null = null;

/**
 * Get or create GitHub App instance
 */
function getGitHubApp(): App {
  if (appInstance) {
    return appInstance;
  }

  const appId = process.env.GITHUB_APP_ID;
  const privateKeyPath = process.env.GITHUB_APP_PRIVATE_KEY_PATH;

  if (!appId || !privateKeyPath) {
    throw new Error("GitHub App not configured. Set GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY_PATH");
  }

  // Read private key from file
  const privateKey = readFileSync(
    join(process.cwd(), privateKeyPath),
    "utf-8"
  );

  appInstance = new App({
    appId,
    privateKey,
  });

  return appInstance;
}

export interface GitHubAppInstallation {
  id: number;
  account: {
    login: string;
    avatar_url: string;
  };
}

export interface GitHubAppRepo {
  id: number;
  name: string;
  full_name: string;
  owner: {
    login: string;
  };
  html_url: string;
  description: string | null;
}

/**
 * GitHub App service for repository operations using installation tokens
 */
export class GitHubAppService {
  private app: App;
  private installationId: number;

  constructor(installationId: number) {
    this.app = getGitHubApp();
    this.installationId = installationId;
  }

  /**
   * Get an Octokit instance authenticated as the installation
   */
  private async getOctokit() {
    return this.app.getInstallationOctokit(this.installationId);
  }

  /**
   * List repositories accessible to this installation
   */
  async listRepositories(): Promise<GitHubAppRepo[]> {
    const octokit = await this.getOctokit();
    const { data } = await octokit.rest.apps.listReposAccessibleToInstallation();
    return data.repositories as GitHubAppRepo[];
  }

  /**
   * Get repository information
   */
  async getRepository(owner: string, repo: string): Promise<GitHubAppRepo> {
    const octokit = await this.getOctokit();
    const { data } = await octokit.rest.repos.get({ owner, repo });
    return data as GitHubAppRepo;
  }

  /**
   * Push virtual file system contents to a GitHub repository
   */
  async pushToRepository(
    owner: string,
    repo: string,
    vfs: VirtualFileSystem,
    commitMessage: string = "Update from UIGen"
  ): Promise<{ sha: string; url: string }> {
    const octokit = await this.getOctokit();

    // Get the default branch
    const { data: repoData } = await octokit.rest.repos.get({ owner, repo });
    const defaultBranch = repoData.default_branch;

    // Get the latest commit SHA
    const { data: refData } = await octokit.rest.git.getRef({
      owner,
      repo,
      ref: `heads/${defaultBranch}`,
    });
    const latestCommitSha = refData.object.sha;

    // Get the tree SHA of the latest commit
    const { data: commitData } = await octokit.rest.git.getCommit({
      owner,
      repo,
      commit_sha: latestCommitSha,
    });
    const baseTreeSha = commitData.tree.sha;

    // Create blobs for all files in the VFS
    const files = vfs.listFiles("/", { recursive: true });
    const tree = await Promise.all(
      files.map(async (file) => {
        const content = vfs.readFile(file.path);
        if (content === null) return null;

        const { data: blob } = await octokit.rest.git.createBlob({
          owner,
          repo,
          content: Buffer.from(content).toString("base64"),
          encoding: "base64",
        });

        return {
          path: file.path.startsWith("/") ? file.path.slice(1) : file.path,
          mode: "100644" as const,
          type: "blob" as const,
          sha: blob.sha,
        };
      })
    );

    // Filter out null entries and create tree
    const validTree = tree.filter(
      (item): item is NonNullable<typeof item> => item !== null
    );

    const { data: newTree } = await octokit.rest.git.createTree({
      owner,
      repo,
      base_tree: baseTreeSha,
      tree: validTree,
    });

    // Create commit
    const { data: newCommit } = await octokit.rest.git.createCommit({
      owner,
      repo,
      message: commitMessage,
      tree: newTree.sha,
      parents: [latestCommitSha],
    });

    // Update reference
    await octokit.rest.git.updateRef({
      owner,
      repo,
      ref: `heads/${defaultBranch}`,
      sha: newCommit.sha,
    });

    return {
      sha: newCommit.sha,
      url: newCommit.html_url,
    };
  }

  /**
   * Pull files from a GitHub repository into a virtual file system
   */
  async pullFromRepository(
    owner: string,
    repo: string,
    path: string = ""
  ): Promise<Record<string, string>> {
    const octokit = await this.getOctokit();
    const files: Record<string, string> = {};

    try {
      const { data } = await octokit.rest.repos.getContent({
        owner,
        repo,
        path,
      });

      // Handle array of files/directories
      if (Array.isArray(data)) {
        for (const item of data) {
          if (item.type === "file") {
            // Get file content
            const { data: fileData } = await octokit.rest.repos.getContent({
              owner,
              repo,
              path: item.path,
            });

            if ("content" in fileData && fileData.content) {
              const content = Buffer.from(
                fileData.content,
                "base64"
              ).toString("utf-8");
              files[`/${item.path}`] = content;
            }
          } else if (item.type === "dir") {
            // Recursively get directory contents
            const dirFiles = await this.pullFromRepository(
              owner,
              repo,
              item.path
            );
            Object.assign(files, dirFiles);
          }
        }
      } else if (data.type === "file" && "content" in data && data.content) {
        // Single file
        const content = Buffer.from(data.content, "base64").toString("utf-8");
        files[`/${data.path}`] = content;
      }
    } catch (error) {
      console.error("Error pulling from repository:", error);
      throw error;
    }

    return files;
  }

  /**
   * Create a new repository
   */
  async createRepository(
    name: string,
    description?: string,
    isPrivate: boolean = false
  ): Promise<GitHubAppRepo> {
    const octokit = await this.getOctokit();
    const { data } = await octokit.rest.repos.createForAuthenticatedUser({
      name,
      description: description || `UIGen project: ${name}`,
      private: isPrivate,
      auto_init: true,
    });

    return data as GitHubAppRepo;
  }
}

/**
 * Create a GitHubAppService instance for an installation
 */
export function createGitHubAppService(installationId: number): GitHubAppService {
  return new GitHubAppService(installationId);
}

/**
 * Get GitHub App installation ID from a user access token
 * This is used during the OAuth flow
 */
export async function getUserInstallations(userToken: string): Promise<GitHubAppInstallation[]> {
  const app = getGitHubApp();

  // Note: We need to use the user's OAuth token to list their installations
  // The @octokit/app doesn't provide this directly, so we'll use octokit
  const { Octokit } = await import("octokit");
  const octokit = new Octokit({ auth: userToken });

  const { data } = await octokit.rest.apps.listInstallationsForAuthenticatedUser({
    per_page: 100,
  });

  return data.installations.map((install: any) => ({
    id: install.id,
    account: {
      login: install.account.login,
      avatar_url: install.account.avatar_url,
    },
  }));
}
