#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createRequire } from "node:module";
import { z } from "zod";
import { runAgy } from "./lib.js";

const { version } = createRequire(import.meta.url)("../package.json") as { version: string };

const server = new McpServer({
  name: "antigravity-mcp",
  version,
});

const usageSchema = z.object({
  inputTokens: z.number(),
  outputTokens: z.number(),
  thinkingTokens: z.number(),
  cacheReadTokens: z.number(),
  totalTokens: z.number(),
});

server.registerTool(
  "cli",
  {
    description:
      "Send a task to Antigravity CLI (agy) and return the response. " +
      "Antigravity runs headlessly with full tool access (file read/write, web search, shell commands) " +
      "and operates in the working directory you specify via `cwd`.\n\n" +
      "When to use this tool:\n" +
      "- Delegating rote coding tasks: boilerplate generation, repetitive refactors, bulk edits across many files\n" +
      "- Getting a second opinion: code review, architecture feedback, sanity-checking an approach\n" +
      "- Research and brainstorming: Antigravity has web search and a large context window, useful for exploring options or summarizing docs\n" +
      "- Large file analysis: processing files that would be expensive to handle directly\n" +
      "- Parallel workstreams: offloading independent subtasks while you continue other work\n\n" +
      "Sandbox: on by default. Antigravity's file tools can still edit the workspace, but shell commands " +
      "can only write under /tmp. Set `sandbox: false` for tasks whose shell commands must write to the " +
      "workspace (builds, installs, git commits, test runs that produce files).\n\n" +
      "Conversation resumption: each response includes a `conversationId`. " +
      "Pass it back via the `conversationId` parameter (with the same `cwd`) to continue a conversation " +
      "without re-sending context — useful for multi-step tasks or follow-up questions.\n\n" +
      "Keep prompts self-contained: include all necessary context in the `prompt` since " +
      "Antigravity has no access to your conversation history or MCP state.",
    inputSchema: {
      prompt: z
        .string()
        .describe("The task or question to send to Antigravity CLI"),
      cwd: z
        .string()
        .describe(
          "Absolute path to the working directory (workspace) for Antigravity to operate in"
        ),
      model: z
        .string()
        .optional()
        .describe(
          "Model to use. Omit to use Antigravity's default. " +
          "Examples: \"gemini-3.1-pro-high\", \"gemini-3.1-pro-low\", \"gemini-3.8-flash-medium\", " +
          "\"claude-sonnet-4-6\", \"claude-opus-4-6-thinking\". Run `agy models` for the full list."
        ),
      effort: z
        .enum(["low", "medium", "high"])
        .optional()
        .describe("Reasoning effort for the session. Omit to use Antigravity's default."),
      sandbox: z
        .boolean()
        .optional()
        .default(true)
        .describe(
          "Run shell commands in a sandbox where they can read anywhere but write only under /tmp. " +
          "File edit tools are unaffected. Default: true."
        ),
      mode: z
        .enum(["accept-edits", "plan"])
        .optional()
        .describe(
          "Agent execution mode. \"plan\" drafts an implementation plan before acting; in headless mode " +
          "the plan is auto-approved, so this shapes the workflow but does not prevent edits."
        ),
      agent: z
        .string()
        .optional()
        .describe(
          "Name of a custom agent to run, defined at .agents/agents/<name>.md in the workspace " +
          "or ~/.gemini/config/agents/. Omit for the default agent."
        ),
      jsonSchema: z
        .record(z.string(), z.unknown())
        .optional()
        .describe(
          "JSON Schema to enforce on the final answer. The parsed object is returned in `structuredOutput`."
        ),
      conversationId: z
        .string()
        .optional()
        .describe(
          "Resume a previous conversation by ID. The ID is returned in the structured output of each call. " +
          "Conversations are scoped to a workspace, so pass the same `cwd` as the original call."
        ),
      timeout: z
        .number()
        .optional()
        .default(120)
        .describe(
          "Timeout in seconds. Default: 120. Increase for complex multi-step tasks. " +
          "On expiry the call returns an error with any partial response in the structured output."
        ),
    },
    outputSchema: {
      conversationId: z.string().nullable().describe("Antigravity conversation ID"),
      response: z.string().describe("Antigravity's text response"),
      status: z.string().nullable().describe("Run status reported by agy (e.g. SUCCESS)"),
      usage: usageSchema.nullable().describe("Token usage for this turn"),
      structuredOutput: z
        .record(z.string(), z.unknown())
        .nullable()
        .describe("Parsed answer when `jsonSchema` was given"),
      durationSeconds: z.number().nullable().describe("Wall-clock time of the run"),
      numTurns: z.number().nullable().describe("Number of agent turns in the conversation"),
      deniedActions: z.array(z.string()).describe("Tools agy was denied permission to use"),
    },
    annotations: {
      readOnlyHint: false,
      openWorldHint: true,
    },
  },
  async ({ prompt, cwd, model, effort, sandbox, mode, agent, jsonSchema, conversationId, timeout }, extra) => {
    const timeoutMs = (timeout ?? 120) * 1000;
    const result = await runAgy(
      prompt,
      cwd,
      timeoutMs,
      { model, effort, sandbox, mode, agent, jsonSchema, conversationId },
      extra.signal
    );

    const structuredContent = result.output as unknown as Record<string, unknown>;
    if (result.isError) {
      return {
        isError: true,
        content: [{ type: "text", text: result.errorMessage ?? "Unknown error" }],
        structuredContent,
      };
    }

    return {
      content: [{ type: "text", text: result.output.response }],
      structuredContent,
    };
  }
);

async function runServer() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

runServer().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
