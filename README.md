<div align="center">

# github-triage-mcp

**Let an AI assistant read and triage your GitHub issues — without giving it the keys to the kingdom.**

[![CI](https://github.com/kenzoob/github-triage-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/kenzoob/github-triage-mcp/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node.js 22+](https://img.shields.io/badge/node-22%2B-339933?logo=node.js&logoColor=white)](package.json)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)](tsconfig.json)
[![MCP](https://img.shields.io/badge/MCP-server-6E56CF)](https://modelcontextprotocol.io)

Read-only access · a repository allowlist · strict input validation · untrusted-content marking — four independent layers standing between a manipulated model and your repos.

</div>

---

## Contents

- [Why this exists](#why-this-exists)
- [What is MCP?](#what-is-mcp)
- [Features](#features)
- [Security model](#security-model)
- [Tech stack](#tech-stack)
- [Getting started](#getting-started)
- [How it works](#how-it-works)
- [Project structure](#project-structure)
- [Testing](#testing)
- [Design decisions](#design-decisions)
- [Roadmap](#roadmap)
- [License](#license)

## Why this exists

Issue trackers are open to the internet. Anything in an issue body or comment — including text engineered to hijack an AI reading it — can end up in your model's context. `github-triage-mcp` is built around that threat model from line one: every tool is **read-only**, every repository must be **explicitly allowlisted**, every input is **validated before it touches the network**, and every piece of third-party text is **fenced off and labeled as untrusted** before it reaches the model.

## What is MCP?

The [Model Context Protocol](https://modelcontextprotocol.io) is an open protocol that connects AI applications to tools and data. An MCP **server** exposes *tools* (functions the model can call), *resources* (data it can read) and *prompts* (reusable instructions). An MCP **client**, such as Claude Desktop or Claude Code, discovers them and calls them when needed.

## Features

### Tools

| Tool | Inputs | Returns |
|------|--------|---------|
| `list_issues` | `owner`, `repo`, `state` (`open`, `closed`, `all`), `labels` (optional), `limit` (max 50) | Number, title, labels, author, date and comment count. Pull requests are excluded. |
| `get_issue` | `owner`, `repo`, `number` | The issue body and its 20 most recent comments |
| `search_issues` | `owner`, `repo`, `query` | Issues matching the search query |
| `repo_activity` | `owner`, `repo`, `days` (default 7, max 90) | Issues opened and closed, and pull requests merged over the period |

### Prompt

- `triage_issues`: lists the open issues of a repository, groups them by theme, suggests a label and a priority for each one, and flags likely duplicates.

### Resource

- `github://{owner}/{repo}/labels`: the labels defined in a repository.

## Security model

Issue content is written by anyone on the internet, and an AI model reads it. This server is designed with that in mind.

| Risk | Mitigation |
|------|------------|
| Overly broad access | A fine-grained GitHub token with **read-only** Issues and Metadata permissions |
| The model is manipulated into reading other repositories | `ALLOWED_REPOS` allowlist; any other repository is rejected with a clear message |
| Malformed or abusive inputs | Every input is validated with Zod (repository name format, bounded `limit` and `days`) before any network call |
| Prompt injection hidden in issues | Issue and comment text is wrapped in clear delimiters and preceded by a warning that it is untrusted content; long texts are truncated |
| Rate limits | When GitHub's rate limit is reached, the tool returns a clear message with the reset time instead of failing |
| Secret leakage | The token never appears in logs or tool output, and a test checks this |

No single measure stops prompt injection completely. The goal is **defense in depth**: even if the model is manipulated, it can only **read** issues from **approved** repositories.

## Tech stack

- TypeScript (strict), Node.js 22+
- Official MCP TypeScript SDK (`@modelcontextprotocol/sdk`, stdio transport)
- Zod for input schemas
- Native `fetch` for the GitHub REST API
- Vitest, MCP Inspector, GitHub Actions

## Getting started

### 1. Create a GitHub token

In GitHub, go to **Settings → Developer settings → Fine-grained tokens**, and create a token with:

- Repository access: only the repositories you want to triage
- Permissions: **Issues: Read-only** and **Metadata: Read-only**

### 2. Install and build

```bash
git clone https://github.com/kenzoob/github-triage-mcp.git
cd github-triage-mcp
npm install
npm run build
```

### 3. Configure

Copy `.env.example` to `.env` (or export these directly in your MCP client config):

| Variable | Description | Example |
|----------|-------------|---------|
| `GITHUB_TOKEN` | Read-only fine-grained token | `github_pat_...` |
| `ALLOWED_REPOS` | Comma-separated allowlist | `kenzoob/My-Engine,facebook/react` |
| `MAX_BODY_CHARS` | Truncation limit for issue text (optional, default `4000`) | `4000` |

The server validates these at startup and exits immediately with a clear error if anything is missing or malformed — no silent misconfiguration.

### 4. Connect it to an MCP client

**Claude Desktop**: open *Settings → Developer → Edit Config* and add:

```json
{
  "mcpServers": {
    "github-triage": {
      "command": "node",
      "args": ["/absolute/path/to/github-triage-mcp/dist/index.js"],
      "env": {
        "GITHUB_TOKEN": "github_pat_...",
        "ALLOWED_REPOS": "kenzoob/My-Engine,facebook/react"
      }
    }
  }
}
```

Restart Claude Desktop, then ask: *"Triage the open issues of facebook/react."*

**Claude Code**:

```bash
claude mcp add --transport stdio \
  --env GITHUB_TOKEN=github_pat_... \
  --env ALLOWED_REPOS=kenzoob/My-Engine \
  github-triage -- node /absolute/path/to/github-triage-mcp/dist/index.js
```

### 5. Inspect it manually

```bash
npx @modelcontextprotocol/inspector node dist/index.js
```

## How it works

```
 MCP client (Claude Desktop, Claude Code, ...)
          │  stdio, JSON-RPC
          ▼
 ┌──────────────────────────────────────────┐
 │ github-triage-mcp                         │
 │  index.ts    server, tools, prompt        │
 │     ├─ config.ts  env validation at boot  │
 │     ├─ guard.ts   allowlist + Zod         │
 │     ├─ github.ts  REST client, PR filter, │
 │     │             rate-limit handling     │
 │     └─ format.ts  output text, truncation,│
 │                    untrusted-content tags │
 └──────────────────────────────────────────┘
          │  HTTPS, read-only token
          ▼
      GitHub REST API
```

GitHub endpoints used:

| Purpose | Endpoint |
|---------|----------|
| List issues | `GET /repos/{owner}/{repo}/issues` |
| Get one issue | `GET /repos/{owner}/{repo}/issues/{number}` |
| Issue comments | `GET /repos/{owner}/{repo}/issues/{number}/comments` |
| Search | `GET /search/issues?q=repo:{owner}/{repo}+is:issue+...` |

The `/issues` endpoint also returns pull requests. They are identified by their `pull_request` field and filtered out.

## Project structure

```
github-triage-mcp/
├── src/
│   ├── index.ts     # server setup, tools, prompt, resource, stdio transport
│   ├── config.ts     # environment validation at startup
│   ├── guard.ts       # allowlist and Zod input schemas
│   ├── github.ts      # GitHub REST client, error handling
│   └── format.ts      # output formatting and untrusted-content wrapping
├── test/
│   ├── github.test.ts # PR filtering, 404s, rate limits, token non-leakage
│   ├── guard.test.ts  # allowlist enforcement, input bounds
│   └── format.test.ts # untrusted-content wrapping and truncation
├── .github/workflows/ci.yml
└── .env.example
```

## Testing

```bash
npm test
```

All tests use a mocked `fetch`; none call the real GitHub API. They check that:

- `list_issues` excludes pull requests
- Repositories outside the allowlist are rejected
- `limit` above 50 is rejected
- Issue text is marked as untrusted and truncated
- Rate-limit errors return the reset time
- A `404` returns "issue or repository not found"
- The token never appears in any output

## Design decisions

- **stdio transport**: for a local tool, it is the simplest and safest option, with no open port. A shared remote deployment would use the Streamable HTTP transport with authentication.
- **Allowlist on top of a read-only token**: defense in depth. The token might still see private repositories; the allowlist limits what the model can reach.
- **Validation at the boundary**: every tool input is checked before any network call.
- **Fail fast at startup**: missing or malformed configuration stops the server immediately with a clear message, instead of failing confusingly on the first tool call.

## Roadmap

- [x] Four read-only tools, triage prompt and labels resource
- [x] Security guards and tests
- [ ] 60-second in-memory cache
- [ ] Optional write tools (add labels, comment) behind an explicit opt-in flag
- [ ] Streamable HTTP transport with OAuth for remote use

## License

[MIT](LICENSE)
