import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildAgyArgs, parseAgyOutput, extractAgyError } from "./lib.js";

describe("buildAgyArgs", () => {
  it("omits --model when not provided", () => {
    const args = buildAgyArgs("hello", undefined);
    assert.ok(!args.includes("--model"));
  });

  it("includes --model when provided", () => {
    const args = buildAgyArgs("hello", "gemini-3-pro");
    const idx = args.indexOf("--model");
    assert.ok(idx !== -1);
    assert.equal(args[idx + 1], "gemini-3-pro");
  });

  it("includes --conversation when conversationId provided", () => {
    const args = buildAgyArgs("x", undefined, "my-conversation-id");
    const idx = args.indexOf("--conversation");
    assert.ok(idx !== -1);
    assert.equal(args[idx + 1], "my-conversation-id");
  });

  it("omits --conversation when conversationId not provided", () => {
    const args = buildAgyArgs("x", undefined);
    assert.ok(!args.includes("--conversation"));
  });

  it("includes --dangerously-skip-permissions", () => {
    const args = buildAgyArgs("x", undefined);
    assert.ok(args.includes("--dangerously-skip-permissions"));
  });

  it("includes --output-format json", () => {
    const args = buildAgyArgs("x", undefined);
    const idx = args.indexOf("--output-format");
    assert.ok(idx !== -1);
    assert.equal(args[idx + 1], "json");
  });

  it("passes the prompt via -p", () => {
    const args = buildAgyArgs("do the thing", undefined);
    assert.equal(args[args.indexOf("-p") + 1], "do the thing");
  });
});

describe("parseAgyOutput", () => {
  const sample = {
    conversation_id: "dc381a74-c1ae-44b2-82cf-f55847818731",
    status: "SUCCESS",
    response: "pong\n",
    duration_seconds: 2.615,
    num_turns: 1,
    usage: {
      input_tokens: 12447,
      output_tokens: 122,
      thinking_tokens: 121,
      cache_read_tokens: 0,
      total_tokens: 12569,
    },
  };

  it("parses a real agy JSON result", () => {
    const result = parseAgyOutput(JSON.stringify(sample));
    assert.equal(result.conversationId, sample.conversation_id);
    assert.equal(result.response, "pong\n");
    assert.equal(result.status, "SUCCESS");
    assert.deepEqual(result.usage, {
      inputTokens: 12447,
      outputTokens: 122,
      thinkingTokens: 121,
      cacheReadTokens: 0,
      totalTokens: 12569,
    });
  });

  it("returns nulls for missing optional fields", () => {
    const result = parseAgyOutput(JSON.stringify({ response: "ok" }));
    assert.equal(result.conversationId, null);
    assert.equal(result.status, null);
    assert.equal(result.usage, null);
  });

  it("defaults missing usage counters to zero", () => {
    const result = parseAgyOutput(JSON.stringify({ response: "ok", usage: { total_tokens: 5 } }));
    assert.deepEqual(result.usage, {
      inputTokens: 0,
      outputTokens: 0,
      thinkingTokens: 0,
      cacheReadTokens: 0,
      totalTokens: 5,
    });
  });

  it("returns raw stdout when JSON parsing fails", () => {
    const raw = "this is not json";
    const result = parseAgyOutput(raw);
    assert.equal(result.response, raw);
    assert.equal(result.conversationId, null);
  });

  it("returns raw stdout for JSON without response field", () => {
    const raw = JSON.stringify({ message: "unexpected shape" });
    const result = parseAgyOutput(raw);
    assert.equal(result.response, raw);
  });

  it("handles empty stdout", () => {
    const result = parseAgyOutput("");
    assert.equal(result.response, "");
  });

  it("trims surrounding whitespace before parsing", () => {
    const result = parseAgyOutput("  " + JSON.stringify({ response: "trimmed" }) + "\n");
    assert.equal(result.response, "trimmed");
  });
});

describe("extractAgyError", () => {
  it("returns null when no AGY_ERROR line is present", () => {
    assert.equal(extractAgyError("warning: something\n"), null);
  });

  it("formats status and message from the AGY_ERROR payload", () => {
    const stderr =
      "some log line\n" +
      'AGY_ERROR: {"status":"RESOURCE_EXHAUSTED","message":"quota exceeded","retryable":true}\n';
    assert.equal(extractAgyError(stderr), "RESOURCE_EXHAUSTED: quota exceeded");
  });

  it("falls back to the raw payload when it is not valid JSON", () => {
    assert.equal(extractAgyError("AGY_ERROR: not json"), "not json");
  });
});
