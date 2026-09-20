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
          "Run `agy models` to list available model names."
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
        .describe("Timeout in seconds. Default: 120. Increase for complex multi-step tasks."),
    },
    outputSchema: {
      conversationId: z.string().nullable().describe("Antigravity conversation ID"),
      response: z.string().describe("Antigravity's text response"),
      status: z.string().nullable().describe("Run status reported by agy (e.g. SUCCESS)"),
      usage: usageSchema.nullable().describe("Token usage for this turn"),
    },
    annotations: {
      readOnlyHint: false,
      openWorldHint: true,
    },
  },
  async ({ prompt, cwd, model, conversationId, timeout }) => {
    const timeoutMs = (timeout ?? 120) * 1000;
    const result = await runAgy(prompt, cwd, model, timeoutMs, conversationId);

    if (result.isError) {
      return {
        isError: true,
        content: [{ type: "text", text: result.errorMessage ?? "Unknown error" }],
        structuredContent: result.output as unknown as Record<string, unknown>,
      };
    }

    return {
      content: [{ type: "text", text: result.output.response }],
      structuredContent: result.output as unknown as Record<string, unknown>,
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
