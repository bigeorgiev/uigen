import "server-only";
import { Octokit } from "octokit";
import { VirtualFileSystem } from "./file-system";

export interface GitHubRepo {
  id: number;
  name: string;
  full_name: string;
  owner: {
    login: string;
  };
  html_url: string;
  description: string | null;
}

export interface GitHubCommitResult {
  sha: string;
  url: string;
}

/**
 * GitHub API service for repository operations
 */
export class GitHubService {
  private octokit: Octokit;

  constructor(accessToken: string) {
    this.octokit = new Octokit({ auth: accessToken });
  }

  /**
   * Create a new GitHub repository
   */
  async createRepository(
    name: string,
    description?: string,
    isPrivate: boolean = false
  ): Promise<GitHubRepo> {
    const { data } = await this.octokit.rest.repos.createForAuthenticatedUser({
      name,
      description: description || `UIGen project: ${name}`,
      private: isPrivate,
      auto_init: true, // Initialize with README
    });

    return data as GitHubRepo;
  }

  /**
   * Get repository information
   */
  async getRepository(owner: string, repo: string): Promise<GitHubRepo> {
    const { data } = await this.octokit.rest.repos.get({
      owner,
      repo,
    });

    return data as GitHubRepo;
  }

  /**
   * List repositories for the authenticated user
   */
  async listRepositories(): Promise<GitHubRepo[]> {
    const { data } = await this.octokit.rest.repos.listForAuthenticatedUser({
      sort: "updated",
      per_page: 100,
    });

    return data as GitHubRepo[];
  }

  /**
   * Push virtual file system contents to a GitHub repository
   * Creates a new commit with all files from the VFS
   */
  async pushToRepository(
    owner: string,
    repo: string,
    vfs: VirtualFileSystem,
    commitMessage: string = "Update from UIGen"
  ): Promise<GitHubCommitResult> {
    // Get the default branch
    const { data: repoData } = await this.octokit.rest.repos.get({
      owner,
      repo,
    });
    const defaultBranch = repoData.default_branch;

    // Get the latest commit SHA
    const { data: refData } = await this.octokit.rest.git.getRef({
      owner,
      repo,
      ref: `heads/${defaultBranch}`,
    });
    const latestCommitSha = refData.object.sha;

    // Get the tree SHA of the latest commit
    const { data: commitData } = await this.octokit.rest.git.getCommit({
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

        const { data: blob } = await this.octokit.rest.git.createBlob({
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

    const { data: newTree } = await this.octokit.rest.git.createTree({
      owner,
      repo,
      base_tree: baseTreeSha,
      tree: validTree,
    });

    // Create commit
    const { data: newCommit } = await this.octokit.rest.git.createCommit({
      owner,
      repo,
      message: commitMessage,
      tree: newTree.sha,
      parents: [latestCommitSha],
    });

    // Update reference
    await this.octokit.rest.git.updateRef({
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
    const files: Record<string, string> = {};

    try {
      const { data } = await this.octokit.rest.repos.getContent({
        owner,
        repo,
        path,
      });

      // Handle array of files/directories
      if (Array.isArray(data)) {
        for (const item of data) {
          if (item.type === "file") {
            // Get file content
            const { data: fileData } = await this.octokit.rest.repos.getContent(
              {
                owner,
                repo,
                path: item.path,
              }
            );

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
   * Check if the authenticated user has access to a repository
   */
  async hasRepositoryAccess(owner: string, repo: string): Promise<boolean> {
    try {
      await this.octokit.rest.repos.get({ owner, repo });
      return true;
    } catch (error) {
      return false;
    }
  }
}

/**
 * Create a GitHubService instance for a user's access token
 */
export function createGitHubService(accessToken: string): GitHubService {
  return new GitHubService(accessToken);
}
