# antigravity-cli-mcp

A minimal MCP server that exposes [Antigravity CLI](https://antigravity.google/docs/cli) (`agy`) as a single tool callable from Claude Code (or any MCP client). This wraps the terminal CLI, not the Antigravity IDE; you need `agy` installed and signed in.

This project started as `gemini-cli-mcp`, wrapping Gemini CLI. Gemini CLI is deprecated in favor of Antigravity, so the server now spawns `agy` instead. The tool interface is the same shape; see [Migrating from gemini-cli-mcp](#migrating-from-gemini-cli-mcp).

## How it works

Claude Code sends prompts to this server via MCP. The server spawns `agy -p "..."` in headless mode and returns the response. Antigravity inherits your Google sign-in, so no API key is required.

```
Claude Code ──MCP/stdio──▶ antigravity-cli-mcp ──spawn──▶ agy -p "..." --output-format json --add-dir <cwd>
```

## Prerequisites

- Antigravity CLI installed, on your `PATH` as `agy`, and signed in (run `agy` once interactively to complete login). Requires a version with headless JSON output (1.1.8 or later; tested against 1.2.7).

## Installation

### From source

```sh
git clone https://github.com/danwahl/antigravity-cli-mcp
cd antigravity-cli-mcp
npm install
npm run build
```

## Configuration

**User install** (available across all projects):

```sh
claude mcp add agy -s user -- npx -y @danwahl/antigravity-cli-mcp
```

**Project install** (shared with your team via `.mcp.json`):

```sh
claude mcp add agy -s project -- npx -y @danwahl/antigravity-cli-mcp
```

Or from source, replace `npx -y @danwahl/antigravity-cli-mcp` with `node /absolute/path/to/antigravity-cli-mcp/dist/index.js`.

Verify with `claude mcp list`.

## Tool: `cli`

| Parameter        | Type    | Required | Description |
|------------------|---------|----------|-------------|
| `prompt`         | string  | yes      | Task or question to send to Antigravity |
| `cwd`            | string  | yes      | Absolute path to the working directory (agy's workspace) |
| `model`          | string  | no       | Model name, e.g. `gemini-3.1-pro-high`, `gemini-3.8-flash-medium`, `claude-sonnet-4-6`. Omit for agy's default. `agy models` lists the options. |
| `effort`         | string  | no       | Reasoning effort: `low`, `medium`, or `high`. Omit for agy's default. |
| `sandbox`        | boolean | no       | Default `true`. Shell commands can read anywhere but write only under `/tmp`; agy's file edit tools are unaffected. Set `false` for builds, installs, git commits, or tests that write to the workspace. |
| `mode`           | string  | no       | `plan` or `accept-edits`. In headless mode plan review is auto-approved, so `plan` shapes the workflow but does not block edits. |
| `agent`          | string  | no       | Custom agent name, defined at `.agents/agents/<name>.md` in the workspace or `~/.gemini/config/agents/`. |
| `jsonSchema`     | object  | no       | JSON Schema enforced on the final answer. The parsed object comes back in `structuredOutput`. |
| `conversationId` | string  | no       | Resume a previous conversation. Returned in the structured output of each call. Pass the same `cwd`, since conversations are workspace-scoped. |
| `timeout`        | number  | no       | Seconds before the run is stopped. Default 120. On expiry the call returns an error; any partial response is in the structured output. |

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
  },
  "structuredOutput": null,
  "durationSeconds": 2.6,
  "numTurns": 1,
  "deniedActions": []
}
```

`agy`'s JSON output does not include per-tool call counts or a per-model breakdown, so those fields from the Gemini CLI version are gone.

### What Antigravity can do

`agy` runs with `--dangerously-skip-permissions`, giving it full tool access: read/write files, run shell commands, web search, and more. Headless agy cannot prompt for permission, so without this flag any tool needing approval is silently denied and the turn ends early. Deny rules in agy's own `settings.json` still apply; when one fires the call returns an error listing `deniedActions`.

The `cwd` you specify is passed as `--add-dir` so it becomes the agent's workspace; the spawn working directory alone is not enough in headless mode.

`--sandbox` is on by default as a check against the permission bypass. It restricts shell commands only: they can read anywhere but write only under `/tmp`. agy's file edit tools can still modify the workspace.

### Timeouts and cancellation

The `timeout` is passed to agy as `--print-timeout`, so agy stops its own turn at the deadline and returns whatever it has. The server reports that as an error with the partial response in the structured output. If agy fails to exit within a few seconds after that, its process group is killed. Cancelling the MCP call (for example, interrupting Claude Code) kills the agy process group immediately.

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
