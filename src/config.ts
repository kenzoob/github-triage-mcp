import { z } from "zod";

const REPO_SLUG_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\/[A-Za-z0-9._-]+$/;

const envSchema = z.object({
  GITHUB_TOKEN: z
    .string({ required_error: "GITHUB_TOKEN is required" })
    .min(1, "GITHUB_TOKEN must not be empty"),
  ALLOWED_REPOS: z
    .string({ required_error: "ALLOWED_REPOS is required" })
    .min(1, "ALLOWED_REPOS must not be empty"),
  MAX_BODY_CHARS: z
    .string()
    .optional()
    .transform((value) => (value === undefined ? 4000 : Number(value)))
    .pipe(z.number().int().min(200).max(20000)),
});

export interface Config {
  readonly githubToken: string;
  readonly allowedRepos: ReadonlySet<string>;
  readonly maxBodyChars: number;
}

function parseAllowedRepos(raw: string): ReadonlySet<string> {
  const slugs = raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  if (slugs.length === 0) {
    throw new Error("ALLOWED_REPOS must contain at least one \"owner/repo\" entry");
  }

  for (const slug of slugs) {
    if (!REPO_SLUG_PATTERN.test(slug)) {
      throw new Error(
        `ALLOWED_REPOS entry "${slug}" is not a valid "owner/repo" slug`,
      );
    }
  }

  return new Set(slugs.map((slug) => slug.toLowerCase()));
}

/**
 * Validates required environment variables at startup and fails fast with a
 * clear message instead of surfacing a confusing error on the first tool call.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(env);

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".") || "env"}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }

  return {
    githubToken: parsed.data.GITHUB_TOKEN,
    allowedRepos: parseAllowedRepos(parsed.data.ALLOWED_REPOS),
    maxBodyChars: parsed.data.MAX_BODY_CHARS,
  };
}
