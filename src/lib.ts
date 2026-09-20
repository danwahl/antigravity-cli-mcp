import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

export type Effort = "low" | "medium" | "high";
export type Mode = "accept-edits" | "plan";

export interface AgyOptions {
  model?: string;
  effort?: Effort;
  mode?: Mode;
  agent?: string;
  sandbox?: boolean;
  jsonSchema?: Record<string, unknown>;
  conversationId?: string;
  timeoutMs?: number;
}

export function buildAgyArgs(prompt: string, cwd: string, opts: AgyOptions = {}): string[] {
  // The spawn cwd alone does not register a workspace in headless mode; without
  // --add-dir the agent is told it has no active workspace and works in its
  // own scratch directory.
  const args = [
    "-p", prompt,
    "--output-format", "json",
    "--dangerously-skip-permissions",
    "--add-dir", cwd,
  ];
  if (opts.sandbox ?? true) {
    args.push("--sandbox");
  }
  if (opts.model) {
    args.push("--model", opts.model);
  }
  if (opts.effort) {
    args.push("--effort", opts.effort);
  }
  if (opts.mode) {
    args.push("--mode", opts.mode);
  }
  if (opts.agent) {
    args.push("--agent", opts.agent);
  }
  if (opts.jsonSchema) {
    args.push("--json-schema", JSON.stringify(opts.jsonSchema));
  }
  if (opts.conversationId) {
    args.push("--conversation", opts.conversationId);
  }
  if (opts.timeoutMs) {
    // Let agy wind down on its own at the deadline and return partial output;
    // the caller's kill timer is only a backstop.
    args.push("--print-timeout", `${Math.ceil(opts.timeoutMs / 1000)}s`);
  }
  return args;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  thinkingTokens: number;
  cacheReadTokens: number;
  totalTokens: number;
}

export interface AgyOutput {
  conversationId: string | null;
  response: string;
  status: string | null;
  usage: Usage | null;
  structuredOutput: Record<string, unknown> | null;
  durationSeconds: number | null;
  numTurns: number | null;
  deniedActions: string[];
}

export const EMPTY_OUTPUT: Readonly<AgyOutput> = {
  conversationId: null,
  response: "",
  status: null,
  usage: null,
  structuredOutput: null,
  durationSeconds: null,
  numTurns: null,
  deniedActions: [],
};

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" ? value : fallback;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseUsage(value: unknown): Usage | null {
  if (!isObject(value)) return null;
  return {
    inputTokens: numberOr(value.input_tokens, 0),
    outputTokens: numberOr(value.output_tokens, 0),
    thinkingTokens: numberOr(value.thinking_tokens, 0),
    cacheReadTokens: numberOr(value.cache_read_tokens, 0),
    totalTokens: numberOr(value.total_tokens, 0),
  };
}

function parseDeniedActions(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((d) => (isObject(d) && typeof d.action === "string" ? d.action : null))
    .filter((a): a is string => a !== null);
}

export function parseAgyOutput(stdout: string): AgyOutput {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return { ...EMPTY_OUTPUT };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { ...EMPTY_OUTPUT, response: trimmed };
  }

  if (!isObject(parsed) || typeof parsed.response !== "string") {
    return { ...EMPTY_OUTPUT, response: trimmed };
  }

  return {
    conversationId: typeof parsed.conversation_id === "string" ? parsed.conversation_id : null,
    response: parsed.response,
    status: typeof parsed.status === "string" ? parsed.status : null,
    usage: parseUsage(parsed.usage),
    structuredOutput: isObject(parsed.structured_output) ? parsed.structured_output : null,
    durationSeconds: numberOrNull(parsed.duration_seconds),
    numTurns: numberOrNull(parsed.num_turns),
    deniedActions: parseDeniedActions(parsed.denied_actions),
  };
}

// agy prints a structured `AGY_ERROR: {...}` line on stderr for model/API failures.
export function extractAgyError(stderr: string): string | null {
  const line = stderr.split("\n").find((l) => l.startsWith("AGY_ERROR:"));
  if (!line) return null;
  const json = line.slice("AGY_ERROR:".length).trim();
  try {
    const parsed = JSON.parse(json) as Record<string, unknown>;
    const message = typeof parsed.message === "string" ? parsed.message : json;
    const status = typeof parsed.status === "string" ? `${parsed.status}: ` : "";
    return `${status}${message}`;
  } catch {
    return json;
  }
}

// On --print-timeout expiry agy exits 0 with status SUCCESS and a stderr notice.
export function hitPrintTimeout(stderr: string): boolean {
  return /print timeout after .* with turn in progress/.test(stderr);
}

export interface RunAgyResult {
  output: AgyOutput;
  isError: boolean;
  errorMessage?: string;
}

function errorResult(errorMessage: string, output: AgyOutput = { ...EMPTY_OUTPUT }): RunAgyResult {
  return { output, isError: true, errorMessage };
}

// Classify a completed (exit 0) run. Exposed for testing.
export function classifyRun(output: AgyOutput, stderr: string, timeoutMs: number): RunAgyResult {
  if (hitPrintTimeout(stderr)) {
    return errorResult(
      `agy timed out after ${timeoutMs / 1000}s; partial response returned in structured output`,
      output
    );
  }
  if (output.deniedActions.length > 0) {
    return errorResult(
      `agy was denied permission for: ${output.deniedActions.join(", ")}. ` +
        "Check permissions.deny rules in agy's settings.json.",
      output
    );
  }
  return { output, isError: false };
}

const KILL_GRACE_MS = 5000;

export function runAgy(
  prompt: string,
  cwd: string,
  timeoutMs: number,
  opts: AgyOptions = {},
  signal?: AbortSignal
): Promise<RunAgyResult> {
  if (!existsSync(cwd)) {
    return Promise.resolve(errorResult(`Working directory does not exist: ${cwd}`));
  }

  return new Promise((resolve) => {
    const args = buildAgyArgs(prompt, cwd, { ...opts, timeoutMs });
    let child: ReturnType<typeof spawn>;

    try {
      child = spawn("agy", args, { cwd, env: process.env, detached: true });
    } catch (err) {
      resolve(errorResult(`Failed to spawn agy: ${String(err)}. Is Antigravity CLI installed?`));
      return;
    }

    let stdout = "";
    let stderr = "";
    let settled = false;

    // Decode as UTF-8 streams so multi-byte characters split across chunks survive.
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");

    // Kill the entire process group (agy + tool grandchildren).
    // Without this, grandchildren can keep stdio pipes open and `close` never fires.
    const killGroup = (sig: NodeJS.Signals) => {
      if (child.pid === undefined) return;
      try {
        process.kill(-child.pid, sig);
      } catch {
        // group already gone
      }
    };

    const terminate = () => {
      killGroup("SIGTERM");
      setTimeout(() => killGroup("SIGKILL"), KILL_GRACE_MS).unref();
    };

    const finish = (r: RunAgyResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      resolve(r);
    };

    // Backstop: agy should exit on its own via --print-timeout, but if it doesn't
    // (or grandchildren keep pipes open), kill the group and resolve without
    // waiting for `close`.
    const timer = setTimeout(() => {
      terminate();
      finish(errorResult(`agy timed out after ${timeoutMs / 1000}s and was killed`));
    }, timeoutMs + KILL_GRACE_MS);

    const onAbort = () => {
      terminate();
      finish(errorResult("agy call was cancelled"));
    };
    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });

    child.stdout?.on("data", (chunk: string) => {
      stdout += chunk;
    });

    child.stderr?.on("data", (chunk: string) => {
      stderr += chunk;
    });

    child.on("error", (err) => {
      const isNotFound =
        (err as NodeJS.ErrnoException).code === "ENOENT" ||
        err.message.includes("ENOENT");
      finish(errorResult(
        isNotFound
          ? "agy binary not found. Install Antigravity CLI and make sure `agy` is on PATH."
          : `Failed to spawn agy: ${err.message}`
      ));
    });

    child.on("close", (code, sig) => {
      if (code !== 0) {
        const how = code === null ? `signal ${sig}` : `code ${code}`;
        const detail = extractAgyError(stderr) || stderr.trim() || stdout.trim() || how;
        finish(errorResult(`agy exited with ${how}: ${detail}`));
        return;
      }

      finish(classifyRun(parseAgyOutput(stdout), stderr, timeoutMs));
    });
  });
}
