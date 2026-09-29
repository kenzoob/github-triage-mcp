import { z } from "zod";

const ownerSchema = z
  .string()
  .min(1)
  .max(39)
  .regex(/^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/, "invalid GitHub owner name");

const repoSchema = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z0-9._-]+$/, "invalid GitHub repository name");

export const listIssuesInputSchema = {
  owner: ownerSchema,
  repo: repoSchema,
  state: z.enum(["open", "closed", "all"]).optional().default("open"),
  labels: z.string().max(500).optional(),
  limit: z.number().int().min(1).max(50).optional().default(20),
};

export const getIssueInputSchema = {
  owner: ownerSchema,
  repo: repoSchema,
  number: z.number().int().positive(),
};

export const searchIssuesInputSchema = {
  owner: ownerSchema,
  repo: repoSchema,
  query: z.string().min(1).max(256),
};

export const repoActivityInputSchema = {
  owner: ownerSchema,
  repo: repoSchema,
  days: z.number().int().min(1).max(90).optional().default(7),
};

export const labelsResourceParamsSchema = z.object({
  owner: ownerSchema,
  repo: repoSchema,
});

export class RepoNotAllowedError extends Error {
  constructor(owner: string, repo: string) {
    super(
      `Repository "${owner}/${repo}" is not in ALLOWED_REPOS. Ask the operator to add it before retrying.`,
    );
    this.name = "RepoNotAllowedError";
  }
}

/**
 * Throws if the given repository is not on the operator-configured allowlist.
 * This runs on top of the read-only GitHub token as defense in depth: even if
 * the model is manipulated, it can only reach approved repositories.
 */
export function assertAllowedRepo(
  owner: string,
  repo: string,
  allowedRepos: ReadonlySet<string>,
): void {
  const slug = `${owner}/${repo}`.toLowerCase();
  if (!allowedRepos.has(slug)) {
    throw new RepoNotAllowedError(owner, repo);
  }
}
