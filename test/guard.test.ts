import { z } from "zod";
import { describe, expect, it } from "vitest";
import { RepoNotAllowedError, assertAllowedRepo, listIssuesInputSchema } from "../src/guard.js";

describe("assertAllowedRepo", () => {
  const allowed = new Set(["kenzoob/demo"]);

  it("passes for an allowlisted repository", () => {
    expect(() => assertAllowedRepo("kenzoob", "demo", allowed)).not.toThrow();
  });

  it("is case-insensitive", () => {
    expect(() => assertAllowedRepo("KenzoOB", "Demo", allowed)).not.toThrow();
  });

  it("rejects a repository outside the allowlist", () => {
    expect(() => assertAllowedRepo("someone-else", "other-repo", allowed)).toThrow(
      RepoNotAllowedError,
    );
  });
});

describe("listIssuesInputSchema", () => {
  const schema = z.object(listIssuesInputSchema);

  it("rejects a limit above 50", () => {
    expect(() =>
      schema.parse({ owner: "kenzoob", repo: "demo", limit: 51 }),
    ).toThrow();
  });

  it("accepts a limit of exactly 50", () => {
    expect(() =>
      schema.parse({ owner: "kenzoob", repo: "demo", limit: 50 }),
    ).not.toThrow();
  });

  it("defaults state to open and limit to 20", () => {
    const parsed = schema.parse({ owner: "kenzoob", repo: "demo" });
    expect(parsed.state).toBe("open");
    expect(parsed.limit).toBe(20);
  });
});
