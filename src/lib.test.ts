import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildAgyArgs,
  parseAgyOutput,
  extractAgyError,
  hitPrintTimeout,
  classifyRun,
  EMPTY_OUTPUT,
} from "./lib.js";

const flagValue = (args: string[], flag: string) => args[args.indexOf(flag) + 1];

describe("buildAgyArgs", () => {
  it("always passes prompt, json output, skip-permissions, and add-dir", () => {
    const args = buildAgyArgs("do the thing", "/w");
    assert.equal(flagValue(args, "-p"), "do the thing");
    assert.equal(flagValue(args, "--output-format"), "json");
    assert.ok(args.includes("--dangerously-skip-permissions"));
    assert.equal(flagValue(args, "--add-dir"), "/w");
  });

  it("enables --sandbox by default and omits it when disabled", () => {
    assert.ok(buildAgyArgs("x", "/w").includes("--sandbox"));
    assert.ok(buildAgyArgs("x", "/w", { sandbox: true }).includes("--sandbox"));
    assert.ok(!buildAgyArgs("x", "/w", { sandbox: false }).includes("--sandbox"));
  });

  it("omits optional flags when not provided", () => {
    const args = buildAgyArgs("x", "/w");
    for (const flag of ["--model", "--effort", "--mode", "--agent", "--json-schema", "--conversation", "--print-timeout"]) {
      assert.ok(!args.includes(flag), `${flag} should be absent`);
    }
  });

  it("passes model, effort, mode, agent, and conversation through", () => {
    const args = buildAgyArgs("x", "/w", {
      model: "gemini-3-pro",
      effort: "low",
      mode: "plan",
      agent: "reviewer",
      conversationId: "conv-1",
    });
    assert.equal(flagValue(args, "--model"), "gemini-3-pro");
    assert.equal(flagValue(args, "--effort"), "low");
    assert.equal(flagValue(args, "--mode"), "plan");
    assert.equal(flagValue(args, "--agent"), "reviewer");
    assert.equal(flagValue(args, "--conversation"), "conv-1");
  });

  it("serializes jsonSchema as a JSON string", () => {
    const schema = { type: "object", properties: { a: { type: "string" } } };
    const args = buildAgyArgs("x", "/w", { jsonSchema: schema });
    assert.deepEqual(JSON.parse(flagValue(args, "--json-schema")), schema);
  });

  it("converts timeoutMs to a whole-second --print-timeout", () => {
    assert.equal(flagValue(buildAgyArgs("x", "/w", { timeoutMs: 120000 }), "--print-timeout"), "120s");
    assert.equal(flagValue(buildAgyArgs("x", "/w", { timeoutMs: 1500 }), "--print-timeout"), "2s");
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
    assert.equal(result.durationSeconds, 2.615);
    assert.equal(result.numTurns, 1);
    assert.deepEqual(result.usage, {
      inputTokens: 12447,
      outputTokens: 122,
      thinkingTokens: 121,
      cacheReadTokens: 0,
      totalTokens: 12569,
    });
    assert.equal(result.structuredOutput, null);
    assert.deepEqual(result.deniedActions, []);
  });

  it("extracts structured_output when a schema was used", () => {
    const result = parseAgyOutput(
      JSON.stringify({ response: "{\"answer\":4}", structured_output: { answer: 4 }, json_schema: {} })
    );
    assert.deepEqual(result.structuredOutput, { answer: 4 });
  });

  it("extracts denied action names", () => {
    const result = parseAgyOutput(
      JSON.stringify({
        response: "",
        denied_actions: [{ action: "write_file", display_name: "WriteToFile" }, { bogus: true }],
      })
    );
    assert.deepEqual(result.deniedActions, ["write_file"]);
  });

  it("returns nulls for missing optional fields", () => {
    const result = parseAgyOutput(JSON.stringify({ response: "ok" }));
    assert.equal(result.conversationId, null);
    assert.equal(result.status, null);
    assert.equal(result.usage, null);
    assert.equal(result.durationSeconds, null);
    assert.equal(result.numTurns, null);
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
    assert.equal(parseAgyOutput(raw).response, raw);
  });

  it("handles empty stdout", () => {
    assert.equal(parseAgyOutput("").response, "");
  });

  it("returns a fresh object rather than the shared empty output", () => {
    const a = parseAgyOutput("");
    a.response = "mutated";
    assert.equal(EMPTY_OUTPUT.response, "");
    assert.equal(parseAgyOutput("").response, "");
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

describe("hitPrintTimeout", () => {
  it("detects agy's print-timeout notice", () => {
    assert.ok(hitPrintTimeout("[agy] print timeout after 6s with turn in progress; returning partial output\n"));
  });

  it("ignores unrelated stderr", () => {
    assert.ok(!hitPrintTimeout("jetski: something else\n"));
  });
});

describe("classifyRun", () => {
  const ok = { ...EMPTY_OUTPUT, response: "done", status: "SUCCESS" };

  it("passes a clean run through", () => {
    const r = classifyRun(ok, "", 120000);
    assert.equal(r.isError, false);
    assert.equal(r.output.response, "done");
  });

  it("marks a print-timeout as an error but keeps partial output", () => {
    const partial = { ...ok, response: "partial" };
    const r = classifyRun(partial, "[agy] print timeout after 120s with turn in progress; returning partial output", 120000);
    assert.equal(r.isError, true);
    assert.match(r.errorMessage ?? "", /timed out after 120s/);
    assert.equal(r.output.response, "partial");
  });

  it("marks denied actions as an error", () => {
    const denied = { ...ok, deniedActions: ["write_file"] };
    const r = classifyRun(denied, "", 120000);
    assert.equal(r.isError, true);
    assert.match(r.errorMessage ?? "", /write_file/);
  });
});
