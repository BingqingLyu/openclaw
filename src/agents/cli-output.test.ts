import { describe, expect, it } from "vitest";
import { parseCliJsonl } from "./cli-output.js";

describe("parseCliJsonl", () => {
  it("parses Claude stream-json result events", () => {
    const result = parseCliJsonl(
      [
        JSON.stringify({ type: "init", session_id: "session-123" }),
        JSON.stringify({
          type: "result",
          session_id: "session-123",
          result: "Claude says hello",
          usage: {
            input_tokens: 12,
            output_tokens: 3,
            cache_read_input_tokens: 4,
          },
        }),
      ].join("\n"),
      {
        command: "claude",
        output: "jsonl",
        sessionIdFields: ["session_id"],
      },
      "claude-cli",
    );

    expect(result).toEqual({
      text: "Claude says hello",
      sessionId: "session-123",
      usage: {
        input: 12,
        output: 3,
        cacheRead: 4,
        cacheWrite: undefined,
        total: undefined,
      },
    });
  });

  it("preserves Claude session metadata even when the final result text is empty", () => {
    const result = parseCliJsonl(
      [
        JSON.stringify({ type: "init", session_id: "session-456" }),
        JSON.stringify({
          type: "result",
          session_id: "session-456",
          result: "   ",
          usage: {
            input_tokens: 18,
            output_tokens: 0,
          },
        }),
      ].join("\n"),
      {
        command: "claude",
        output: "jsonl",
        sessionIdFields: ["session_id"],
      },
      "claude-cli",
    );

    expect(result).toEqual({
      text: "",
      sessionId: "session-456",
      usage: {
        input: 18,
        output: undefined,
        cacheRead: undefined,
        cacheWrite: undefined,
        total: undefined,
      },
    });
  });

  it("prefers task_complete.last_agent_message over commentary and final-answer events", () => {
    const result = parseCliJsonl(
      [
        JSON.stringify({ type: "response_start", thread_id: "thread-789" }),
        JSON.stringify({
          type: "event_msg",
          payload: {
            type: "agent_message",
            phase: "commentary",
            message: "Commentary that should stay internal",
          },
        }),
        JSON.stringify({
          type: "response_item",
          payload: {
            type: "message",
            role: "assistant",
            phase: "final_answer",
            content: [{ type: "output_text", text: "Final answer from phase" }],
          },
        }),
        JSON.stringify({
          type: "event_msg",
          payload: {
            type: "task_complete",
            last_agent_message: "Terminal answer from task_complete",
          },
          usage: {
            input_tokens: 9,
            output_tokens: 4,
          },
        }),
      ].join("\n"),
      {
        command: "codex",
        output: "jsonl",
      },
      "openai-cli",
    );

    expect(result).toEqual({
      text: "Terminal answer from task_complete",
      sessionId: "thread-789",
      usage: {
        input: 9,
        output: 4,
        cacheRead: undefined,
        cacheWrite: undefined,
        total: undefined,
      },
    });
  });

  it("prefers final-answer phase content and ignores commentary-phase item text", () => {
    const result = parseCliJsonl(
      [
        JSON.stringify({
          item: {
            type: "message",
            text: "Commentary text",
            phase: "commentary",
          },
        }),
        JSON.stringify({
          type: "response_item",
          payload: {
            type: "message",
            role: "assistant",
            phase: "final_answer",
            content: [{ type: "output_text", text: "Final answer from payload" }],
          },
        }),
      ].join("\n"),
      {
        command: "codex",
        output: "jsonl",
      },
      "openai-cli",
    );

    expect(result).toEqual({
      text: "Final answer from payload",
      sessionId: undefined,
      usage: undefined,
    });
  });
});
