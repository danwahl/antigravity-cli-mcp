# agy-mcp

A minimal MCP server that exposes [Antigravity CLI](https://antigravity.google/) (`agy`) as a single tool callable from Claude Code (or any MCP client).

This project started as `gemini-cli-mcp`, wrapping Gemini CLI. Gemini CLI is deprecated in favor of Antigravity, so the server now spawns `agy` instead. The tool interface is the same shape; see [Migrating from gemini-cli-mcp](#migrating-from-gemini-cli-mcp).

## How it works

Claude Code sends prompts to this server via MCP. The server spawns `agy -p "..."` in headless mode and returns the response. Antigravity inherits your Google sign-in, so no API key is required.

```
Claude Code ──MCP/stdio──▶ agy-mcp ──spawn──▶ agy -p "..." --output-format json
```

## Prerequisites

- Antigravity CLI installed, on your `PATH` as `agy`, and signed in (run `agy` once interactively to complete login). Requires a version with headless JSON output (1.1.8 or later; tested against 1.2.7).

## Installation

### From source

```sh
git clone https://github.com/danwahl/gemini-cli-mcp
cd gemini-cli-mcp
npm install
npm run build
```

## Configuration

**User install** (available across all projects):

```sh
claude mcp add agy -s user -- npx -y @danwahl/agy-mcp
```

**Project install** (shared with your team via `.mcp.json`):

```sh
claude mcp add agy -s project -- npx -y @danwahl/agy-mcp
```

Or from source, replace `npx -y @danwahl/agy-mcp` with `node /absolute/path/to/gemini-cli-mcp/dist/index.js`.

Verify with `claude mcp list`.

## Tool: `cli`

| Parameter        | Type   | Required | Description |
|------------------|--------|----------|-------------|
| `prompt`         | string | yes      | Task or question to send to Antigravity |
| `cwd`            | string | yes      | Absolute path to the working directory (agy's workspace) |
| `model`          | string | no       | Model name. Omit for agy's default. `agy models` lists the options. |
| `conversationId` | string | no       | Resume a previous conversation. Returned in the structured output of each call. Pass the same `cwd`, since conversations are workspace-scoped. |
| `timeout`        | number | no       | Seconds before the run is killed. Default 120. |

### Structured output

Each call returns structured content alongside the text response:

```json
{
  "conversationId": "dc381a74-...",
  "response": "Antigravity's answer...",
  "status": "SUCCESS",
  "usage": {
    "inputTokens": 12447,
    "outputTokens": 122,
    "thinkingTokens": 121,
    "cacheReadTokens": 0,
    "totalTokens": 12569
  }
}
```

`agy`'s JSON output does not include per-tool call counts or a per-model breakdown, so those fields from the Gemini CLI version are gone.

### What Antigravity can do

`agy` runs with `--dangerously-skip-permissions`, giving it full tool access: read/write files, run shell commands, web search, and more. It operates in the `cwd` you specify. Persisted `settings.json` permission rules still apply.

### Errors

On a model or API failure `agy` prints an `AGY_ERROR: {...}` line to stderr and exits with code 3. The server surfaces the status and message from that line as the tool error.

## Migrating from gemini-cli-mcp

- `sessionId` is now `conversationId` (both the input parameter and the output field).
- `models` and `tools` in the structured output are replaced by a single `usage` object.
- Gemini CLI model aliases (`auto`, `pro`, `flash`, `flash-lite`) are not recognized; use a name from `agy models`.
- Re-add the server under the new package name: `claude mcp remove gemini-cli` then the `claude mcp add` command above.

## Development

```sh
npm run build   # compile with tsc
npm test        # run unit tests
```

### Smoke test

```sh
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | node dist/index.js
```

## Design

One tool, no prompt wrappers. Claude Code is the orchestrator: it decides what to ask Antigravity and how to phrase it. This server is a thin, reliable pipe between MCP and `agy -p`.

See [CLAUDE.md](./CLAUDE.md) for project conventions.
