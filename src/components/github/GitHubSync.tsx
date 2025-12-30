"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Github, GitBranch, Upload, Download, Link2, Unlink } from "lucide-react";
import {
  createAndLinkRepository,
  linkExistingRepository,
  pushToGitHub,
  pullFromGitHub,
  unlinkRepository,
} from "@/actions/github";
import { useRouter } from "next/navigation";

interface GitHubSyncProps {
  projectId: string;
  projectName: string;
  githubRepoOwner?: string | null;
  githubRepoName?: string | null;
  lastSyncedAt?: Date | null;
  hasGitHubAccount: boolean;
}

export function GitHubSync({
  projectId,
  projectName,
  githubRepoOwner,
  githubRepoName,
  lastSyncedAt,
  hasGitHubAccount,
}: GitHubSyncProps) {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [showCreateRepo, setShowCreateRepo] = useState(false);
  const [showLinkRepo, setShowLinkRepo] = useState(false);
  const [newRepoName, setNewRepoName] = useState(
    projectName.toLowerCase().replace(/\s+/g, "-")
  );
  const [isPrivate, setIsPrivate] = useState(false);
  const [linkOwner, setLinkOwner] = useState("");
  const [linkRepoName, setLinkRepoName] = useState("");

  const isLinked = !!githubRepoOwner && !!githubRepoName;

  const handleCreateRepo = async () => {
    setIsLoading(true);
    setError("");

    const result = await createAndLinkRepository(
      projectId,
      newRepoName,
      isPrivate
    );

    if (result.success) {
      setShowCreateRepo(false);
      router.refresh();
    } else {
      setError(result.error || "Failed to create repository");
    }

    setIsLoading(false);
  };

  const handleLinkRepo = async () => {
    setIsLoading(true);
    setError("");

    const result = await linkExistingRepository(
      projectId,
      linkOwner,
      linkRepoName
    );

    if (result.success) {
      setShowLinkRepo(false);
      router.refresh();
    } else {
      setError(result.error || "Failed to link repository");
    }

    setIsLoading(false);
  };

  const handlePush = async () => {
    setIsLoading(true);
    setError("");

    const result = await pushToGitHub(projectId);

    if (result.success) {
      router.refresh();
    } else {
      setError(result.error || "Failed to push to GitHub");
    }

    setIsLoading(false);
  };

  const handlePull = async () => {
    setIsLoading(true);
    setError("");

    const result = await pullFromGitHub(projectId);

    if (result.success) {
      router.refresh();
    } else {
      setError(result.error || "Failed to pull from GitHub");
    }

    setIsLoading(false);
  };

  const handleUnlink = async () => {
    if (
      !confirm(
        "Are you sure you want to unlink this repository? This won't delete the GitHub repository."
      )
    ) {
      return;
    }

    setIsLoading(true);
    setError("");

    const result = await unlinkRepository(projectId);

    if (result.success) {
      router.refresh();
    } else {
      setError(result.error || "Failed to unlink repository");
    }

    setIsLoading(false);
  };

  if (!hasGitHubAccount) {
    return (
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          window.location.href = "/api/auth/github";
        }}
      >
        <Github className="mr-2 h-4 w-4" />
        Connect GitHub
      </Button>
    );
  }

  if (isLinked) {
    return (
      <div className="flex items-center gap-2">
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm">
              <Github className="mr-2 h-4 w-4" />
              {githubRepoOwner}/{githubRepoName}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-80">
            <div className="space-y-4">
              <div>
                <h4 className="font-semibold mb-2">GitHub Repository</h4>
                <a
                  href={`https://github.com/${githubRepoOwner}/${githubRepoName}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-blue-600 hover:underline flex items-center gap-1"
                >
                  <GitBranch className="h-3 w-3" />
                  {githubRepoOwner}/{githubRepoName}
                </a>
                {lastSyncedAt && (
                  <p className="text-xs text-gray-500 mt-1">
                    Last synced: {new Date(lastSyncedAt).toLocaleString()}
                  </p>
                )}
              </div>

              {error && (
                <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded p-2">
                  {error}
                </div>
              )}

              <div className="flex gap-2">
                <Button
                  onClick={handlePush}
                  disabled={isLoading}
                  size="sm"
                  className="flex-1"
                >
                  <Upload className="mr-2 h-4 w-4" />
                  Push
                </Button>
                <Button
                  onClick={handlePull}
                  disabled={isLoading}
                  variant="outline"
                  size="sm"
                  className="flex-1"
                >
                  <Download className="mr-2 h-4 w-4" />
                  Pull
                </Button>
              </div>

              <Button
                onClick={handleUnlink}
                disabled={isLoading}
                variant="outline"
                size="sm"
                className="w-full"
              >
                <Unlink className="mr-2 h-4 w-4" />
                Unlink Repository
              </Button>
            </div>
          </PopoverContent>
        </Popover>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Popover open={showCreateRepo} onOpenChange={setShowCreateRepo}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm">
            <Github className="mr-2 h-4 w-4" />
            Create Repository
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-80">
          <div className="space-y-4">
            <h4 className="font-semibold">Create GitHub Repository</h4>

            <div className="space-y-2">
              <Label htmlFor="repo-name">Repository Name</Label>
              <Input
                id="repo-name"
                value={newRepoName}
                onChange={(e) => setNewRepoName(e.target.value)}
                placeholder="my-awesome-project"
                disabled={isLoading}
              />
            </div>

            <div className="flex items-center space-x-2">
              <input
                type="checkbox"
                id="is-private"
                checked={isPrivate}
                onChange={(e) => setIsPrivate(e.target.checked)}
                disabled={isLoading}
                className="rounded"
              />
              <Label htmlFor="is-private" className="cursor-pointer">
                Private repository
              </Label>
            </div>

            {error && (
              <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded p-2">
                {error}
              </div>
            )}

            <Button
              onClick={handleCreateRepo}
              disabled={isLoading || !newRepoName}
              className="w-full"
            >
              Create & Link
            </Button>
          </div>
        </PopoverContent>
      </Popover>

      <Popover open={showLinkRepo} onOpenChange={setShowLinkRepo}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm">
            <Link2 className="mr-2 h-4 w-4" />
            Link Existing
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-80">
          <div className="space-y-4">
            <h4 className="font-semibold">Link Existing Repository</h4>

            <div className="space-y-2">
              <Label htmlFor="link-owner">Repository Owner</Label>
              <Input
                id="link-owner"
                value={linkOwner}
                onChange={(e) => setLinkOwner(e.target.value)}
                placeholder="username or organization"
                disabled={isLoading}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="link-repo">Repository Name</Label>
              <Input
                id="link-repo"
                value={linkRepoName}
                onChange={(e) => setLinkRepoName(e.target.value)}
                placeholder="repository-name"
                disabled={isLoading}
              />
            </div>

            {error && (
              <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded p-2">
                {error}
              </div>
            )}

            <Button
              onClick={handleLinkRepo}
              disabled={isLoading || !linkOwner || !linkRepoName}
              className="w-full"
            >
              Link Repository
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
