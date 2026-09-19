import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

export function buildAgyArgs(
  prompt: string,
  model: string | undefined,
  conversationId?: string
): string[] {
  const args = ["-p", prompt, "--output-format", "json", "--dangerously-skip-permissions"];
  if (model) {
    args.push("--model", model);
  }
  if (conversationId) {
    args.push("--conversation", conversationId);
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
}

const EMPTY_OUTPUT: AgyOutput = { conversationId: null, response: "", status: null, usage: null };

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" ? value : fallback;
}

function parseUsage(value: unknown): Usage | null {
  if (value === null || typeof value !== "object") return null;
  const u = value as Record<string, unknown>;
  return {
    inputTokens: numberOr(u.input_tokens, 0),
    outputTokens: numberOr(u.output_tokens, 0),
    thinkingTokens: numberOr(u.thinking_tokens, 0),
    cacheReadTokens: numberOr(u.cache_read_tokens, 0),
    totalTokens: numberOr(u.total_tokens, 0),
  };
}

export function parseAgyOutput(stdout: string): AgyOutput {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return EMPTY_OUTPUT;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { ...EMPTY_OUTPUT, response: trimmed };
  }

  if (parsed === null || typeof parsed !== "object") {
    return { ...EMPTY_OUTPUT, response: trimmed };
  }
  const obj = parsed as Record<string, unknown>;
  if (typeof obj.response !== "string") {
    return { ...EMPTY_OUTPUT, response: trimmed };
  }

  return {
    conversationId: typeof obj.conversation_id === "string" ? obj.conversation_id : null,
    response: obj.response,
    status: typeof obj.status === "string" ? obj.status : null,
    usage: parseUsage(obj.usage),
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

export interface RunAgyResult {
  output: AgyOutput;
  isError: boolean;
  errorMessage?: string;
}

function errorResult(errorMessage: string): RunAgyResult {
  return { output: EMPTY_OUTPUT, isError: true, errorMessage };
}

export function runAgy(
  prompt: string,
  cwd: string,
  model: string | undefined,
  timeoutMs: number,
  conversationId?: string
): Promise<RunAgyResult> {
  if (!existsSync(cwd)) {
    return Promise.resolve(errorResult(`Working directory does not exist: ${cwd}`));
  }

  return new Promise((resolve) => {
    const args = buildAgyArgs(prompt, model, conversationId);
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

    const finish = (r: RunAgyResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(r);
    };

    const timer = setTimeout(() => {
      killGroup("SIGTERM");
      setTimeout(() => killGroup("SIGKILL"), 5000).unref();
      // Resolve immediately — don't wait for `close`, which may never fire
      // if grandchildren keep stdio pipes open.
      finish(errorResult(`agy timed out after ${timeoutMs / 1000}s`));
    }, timeoutMs);

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
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

    child.on("close", (code) => {
      if (code !== 0) {
        const detail = extractAgyError(stderr) || stderr.trim() || stdout.trim() || `exit code ${code}`;
        finish(errorResult(`agy exited with code ${code}: ${detail}`));
        return;
      }

      finish({ output: parseAgyOutput(stdout), isError: false });
    });
  });
}
