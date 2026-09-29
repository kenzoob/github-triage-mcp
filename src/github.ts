const API_BASE = "https://api.github.com";
const API_VERSION = "2022-11-28";

export interface GitHubIssue {
  readonly number: number;
  readonly title: string;
  readonly state: "open" | "closed";
  readonly labels: readonly string[];
  readonly author: string;
  readonly createdAt: string;
  readonly commentCount: number;
  readonly body: string;
}

export interface GitHubComment {
  readonly author: string;
  readonly createdAt: string;
  readonly body: string;
}

export interface GitHubLabel {
  readonly name: string;
  readonly description: string | null;
}

export interface RepoActivity {
  readonly days: number;
  readonly opened: readonly string[];
  readonly closed: readonly string[];
  readonly merged: readonly string[];
}

export type GitHubErrorKind = "not_found" | "rate_limited" | "http_error";

export class GitHubApiError extends Error {
  readonly kind: GitHubErrorKind;
  readonly resetAt?: string;

  constructor(kind: GitHubErrorKind, message: string, resetAt?: string) {
    super(message);
    this.name = "GitHubApiError";
    this.kind = kind;
    if (resetAt !== undefined) {
      this.resetAt = resetAt;
    }
  }
}

interface RawIssue {
  readonly number: number;
  readonly title: string;
  readonly state: "open" | "closed";
  readonly labels: ReadonlyArray<{ readonly name: string } | string>;
  readonly user: { readonly login: string } | null;
  readonly created_at: string;
  readonly comments: number;
  readonly body: string | null;
  readonly pull_request?: unknown;
}

interface RawComment {
  readonly user: { readonly login: string } | null;
  readonly created_at: string;
  readonly body: string | null;
}

interface RawLabel {
  readonly name: string;
  readonly description: string | null;
}

interface RawSearchResult {
  readonly total_count: number;
  readonly items: ReadonlyArray<{ readonly title: string }>;
}

function toIssue(raw: RawIssue): GitHubIssue {
  return {
    number: raw.number,
    title: raw.title,
    state: raw.state,
    labels: raw.labels.map((label) => (typeof label === "string" ? label : label.name)),
    author: raw.user?.login ?? "unknown",
    createdAt: raw.created_at,
    commentCount: raw.comments,
    body: raw.body ?? "",
  };
}

function toComment(raw: RawComment): GitHubComment {
  return {
    author: raw.user?.login ?? "unknown",
    createdAt: raw.created_at,
    body: raw.body ?? "",
  };
}

function isPullRequest(raw: RawIssue): boolean {
  return raw.pull_request !== undefined;
}

/**
 * Performs an authenticated GitHub REST request. Never logs the token, and
 * translates rate limiting / not-found responses into typed errors so
 * callers can produce clear messages instead of raw HTTP failures.
 */
async function githubRequest<T>(token: string, path: string): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": API_VERSION,
      "User-Agent": "github-triage-mcp",
    },
  });

  if (response.status === 404) {
    throw new GitHubApiError("not_found", "issue or repository not found");
  }

  const rateRemaining = response.headers.get("x-ratelimit-remaining");
  if ((response.status === 403 || response.status === 429) && rateRemaining === "0") {
    const resetHeader = response.headers.get("x-ratelimit-reset");
    const resetAt = resetHeader
      ? new Date(Number(resetHeader) * 1000).toISOString()
      : "unknown";
    throw new GitHubApiError(
      "rate_limited",
      `GitHub API rate limit reached, resets at ${resetAt}`,
      resetAt,
    );
  }

  if (!response.ok) {
    throw new GitHubApiError(
      "http_error",
      `GitHub API request failed with status ${response.status}`,
    );
  }

  return (await response.json()) as T;
}

export async function listIssues(
  token: string,
  owner: string,
  repo: string,
  options: { state: "open" | "closed" | "all"; labels?: string; limit: number },
): Promise<GitHubIssue[]> {
  const params = new URLSearchParams({
    state: options.state,
    per_page: String(Math.min(options.limit * 2, 100)),
  });
  if (options.labels) {
    params.set("labels", options.labels);
  }

  const raw = await githubRequest<RawIssue[]>(
    token,
    `/repos/${owner}/${repo}/issues?${params.toString()}`,
  );

  return raw
    .filter((issue) => !isPullRequest(issue))
    .slice(0, options.limit)
    .map(toIssue);
}

export async function getIssue(
  token: string,
  owner: string,
  repo: string,
  number: number,
): Promise<{ issue: GitHubIssue; comments: GitHubComment[] }> {
  const rawIssue = await githubRequest<RawIssue>(
    token,
    `/repos/${owner}/${repo}/issues/${number}`,
  );
  const rawComments = await githubRequest<RawComment[]>(
    token,
    `/repos/${owner}/${repo}/issues/${number}/comments?per_page=100`,
  );

  return {
    issue: toIssue(rawIssue),
    comments: rawComments.slice(-20).map(toComment),
  };
}

export async function searchIssues(
  token: string,
  owner: string,
  repo: string,
  query: string,
): Promise<GitHubIssue[]> {
  const q = `repo:${owner}/${repo} is:issue ${query}`;
  const raw = await githubRequest<{ items: RawIssue[] }>(
    token,
    `/search/issues?q=${encodeURIComponent(q)}&per_page=50`,
  );

  return raw.items.filter((issue) => !isPullRequest(issue)).map(toIssue);
}

export async function getLabels(
  token: string,
  owner: string,
  repo: string,
): Promise<GitHubLabel[]> {
  const raw = await githubRequest<RawLabel[]>(
    token,
    `/repos/${owner}/${repo}/labels?per_page=100`,
  );
  return raw.map((label) => ({ name: label.name, description: label.description }));
}

export async function repoActivity(
  token: string,
  owner: string,
  repo: string,
  days: number,
): Promise<RepoActivity> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const slug = `${owner}/${repo}`;

  const [opened, closed, merged] = await Promise.all([
    githubRequest<RawSearchResult>(
      token,
      `/search/issues?q=${encodeURIComponent(`repo:${slug} is:issue created:>=${since}`)}&per_page=100`,
    ),
    githubRequest<RawSearchResult>(
      token,
      `/search/issues?q=${encodeURIComponent(`repo:${slug} is:issue closed:>=${since}`)}&per_page=100`,
    ),
    githubRequest<RawSearchResult>(
      token,
      `/search/issues?q=${encodeURIComponent(`repo:${slug} is:pr is:merged merged:>=${since}`)}&per_page=100`,
    ),
  ]);

  return {
    days,
    opened: opened.items.map((item) => item.title),
    closed: closed.items.map((item) => item.title),
    merged: merged.items.map((item) => item.title),
  };
}
