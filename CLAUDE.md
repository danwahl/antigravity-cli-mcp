# antigravity-mcp

Minimal MCP server that wraps Antigravity CLI (`agy`) as a single tool for use from Claude Code. Formerly gemini-cli-mcp; Gemini CLI is deprecated.

## Key decisions
- One tool (`cli`), no prompt wrappers
- Uses `--output-format json` (not stream-json) since we return final results
- Uses `--dangerously-skip-permissions` for headless operation
- Passes `--add-dir <cwd>`: in headless mode the spawn cwd alone does not register a workspace, and the agent then works in its own scratch dir
- Resumes with `--conversation <id>`
- `--sandbox` on by default (shell writes limited to /tmp; file tools unaffected); `sandbox: false` opts out
- `--print-timeout` set from the tool timeout so agy exits cleanly with partial output; agy reports that as exit 0 / SUCCESS plus a stderr notice, which we detect and turn into an error. A process-group kill fires 5s later as a backstop, and MCP cancellation kills immediately
- Without `--dangerously-skip-permissions` headless agy soft-denies tools and reports `denied_actions`; we surface those as errors
- `--mode plan` is auto-approved in headless mode and does not block edits
- agy's JSON result is flat (`conversation_id`, `status`, `response`, `usage`), no per-tool or per-model stats
- MCP SDK v1.x (v2 is pre-alpha, not production ready)

## Design principle: Parsimony
This project is intentionally minimal. Before adding any code, ask:
- Does Claude Code actually need this, or can it handle it in the prompt?
- Can this be a parameter on the existing tool instead of a new tool?
- Is this a real problem or a hypothetical one?

Do not add features speculatively. Do not add abstraction layers for a single tool.
The server code lives in `src/index.ts` (entry point) and `src/lib.ts` (pure functions). Keep both small and focused.

## Build & test
- `.mcp.json` points the `agy` server at `dist/index.js` for this repo. `npx -y @danwahl/antigravity-mcp` fails from inside the package's own source tree (npx treats the project as satisfying the spec and looks for the bin on PATH), so the project override is required here.
- `npm run build` to compile with tsc
- Test manually: `echo '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | node dist/index.js`

## Git practices
- Initialize the repo with `git init` before writing any code
- **Commit early and often** at meaningful checkpoints
- Write clear, conventional commit messages
- Do NOT squash everything into one giant commit at the end

## Pre-commit checks
Before every commit, run:
1. `npm run build` — must compile cleanly with zero errors
2. `npm test` — all tests must pass
3. Review the diff — no debug `console.log` statements, no commented-out code, no TODOs without a tracking issue

## Testing strategy
- Unit test pure functions: response parsing, stats extraction, error classification, argument building
- Do NOT mock the MCP SDK
- Do NOT unit test the spawn itself
- Use Node's built-in test runner (`node --test`)
- Test file: `src/lib.test.ts`

## Code style
- No linter config needed — just be consistent
- Prefer `const` over `let`, never use `var`
- Prefer early returns over nested conditionals
- Extract pure functions for testability
- Keep the handler thin
- No classes. Plain functions only.
- No barrel exports

## agy reference
- `agy --help` lists flags; `agy changelog` documents headless behavior changes
- Fatal errors: `AGY_ERROR: {...}` line on stderr, exit code 3
- `agy models` lists model names (no `--output-format` flag on that subcommand as of 1.2.7)
