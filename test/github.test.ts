import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GitHubApiError, getIssue, listIssues, searchIssues } from "../src/github.js";

const TOKEN = "secret-token-should-not-leak";

function jsonResponse(
  body: unknown,
  init: { status?: number; headers?: Record<string, string> } = {},
): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: init.headers,
  });
}

describe("github client", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("excludes pull requests from list_issues", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse([
        {
          number: 1,
          title: "A real issue",
          state: "open",
          labels: [],
          user: { login: "alice" },
          created_at: "2024-01-01T00:00:00Z",
          comments: 0,
          body: "hello",
        },
        {
          number: 2,
          title: "A pull request",
          state: "open",
          labels: [],
          user: { login: "bob" },
          created_at: "2024-01-02T00:00:00Z",
          comments: 0,
          body: "code",
          pull_request: { url: "https://api.github.com/pulls/2" },
        },
      ]),
    );

    const issues = await listIssues(TOKEN, "kenzoob", "demo", {
      state: "open",
      limit: 20,
    });

    expect(issues).toHaveLength(1);
    expect(issues[0]?.number).toBe(1);
  });

  it("throws a not-found error with a clear message on 404", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: "Not Found" }, { status: 404 }));

    await expect(getIssue(TOKEN, "kenzoob", "demo", 999)).rejects.toMatchObject({
      kind: "not_found",
      message: "issue or repository not found",
    });
  });

  it("returns the rate-limit reset time when the limit is reached", async () => {
    const resetUnix = Math.floor(Date.now() / 1000) + 3600;
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        { message: "API rate limit exceeded" },
        {
          status: 403,
          headers: {
            "x-ratelimit-remaining": "0",
            "x-ratelimit-reset": String(resetUnix),
          },
        },
      ),
    );

    const error = await getIssue(TOKEN, "kenzoob", "demo", 1).catch((err: unknown) => err);

    expect(error).toBeInstanceOf(GitHubApiError);
    expect((error as GitHubApiError).kind).toBe("rate_limited");
    expect((error as GitHubApiError).resetAt).toBe(new Date(resetUnix * 1000).toISOString());
  });

  it("never leaks the token in a thrown error message", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: "boom" }, { status: 500 }));

    const error = await getIssue(TOKEN, "kenzoob", "demo", 1).catch((err: unknown) => err);

    expect(String((error as Error).message)).not.toContain(TOKEN);
  });

  it("sends the token only in the Authorization header, never as a query param", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([]));

    await listIssues(TOKEN, "kenzoob", "demo", { state: "open", limit: 20 });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).not.toContain(TOKEN);
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
  });

  it("keeps only search results from the requested repository", async () => {
    const issue = (number: number, repoUrl: string) => ({
      number,
      title: `issue ${number}`,
      state: "open",
      labels: [],
      user: { login: "someone" },
      created_at: "2026-09-01T00:00:00Z",
      comments: 0,
      body: "",
      repository_url: repoUrl,
    });
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        total_count: 2,
        items: [
          issue(1, "https://api.github.com/repos/kenzoob/demo"),
          issue(2, "https://api.github.com/repos/someone/private"),
        ],
      }),
    );

    const issues = await searchIssues(TOKEN, "kenzoob", "demo", "bug");

    expect(issues.map((i) => i.number)).toEqual([1]);
  });
});
