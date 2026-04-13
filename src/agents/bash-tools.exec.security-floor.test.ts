/**
 * Tests that a model-supplied security:"allowlist" argument cannot downgrade
 * an agent configured with tools.exec.security="full".
 *
 * Regression test for: Codex models (gpt-5.4-mini etc.) routinely pass
 * security:"allowlist" in their exec tool call arguments. Before this fix,
 * minSecurity("full", "allowlist") = "allowlist", causing allowlist-miss errors
 * on agents that are explicitly granted full exec access via config.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { captureEnv } from "../test-utils/env.js";
import { resetProcessRegistryForTests } from "./bash-process-registry.js";
import { createExecTool } from "./bash-tools.exec.js";
import { resolveShellFromPath } from "./shell-utils.js";

const isWin = process.platform === "win32";
const defaultShell = isWin
  ? undefined
  : process.env.OPENCLAW_TEST_SHELL || resolveShellFromPath("bash") || process.env.SHELL || "sh";

describe("exec security floor: configured full cannot be downgraded by model", () => {
  let envSnapshot: ReturnType<typeof captureEnv>;

  beforeEach(() => {
    vi.useRealTimers();
    envSnapshot = captureEnv(["SHELL"]);
    if (!isWin && defaultShell) {
      process.env.SHELL = defaultShell;
    }
    resetProcessRegistryForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
    envSnapshot.restore();
  });

  it("executes successfully when configured security=full and model passes security=allowlist", async () => {
    // Simulates a Codex model calling exec with security:"allowlist" on an agent
    // that has tools.exec.security="full" configured. Should succeed, not throw
    // "exec denied: allowlist miss".
    const tool = createExecTool({
      security: "full",
      ask: "off",
    });

    const result = await tool.execute("call-1", {
      command: isWin ? "echo hello" : "echo hello",
      // Model-supplied security downgrade — should be ignored when configured=full
      security: "allowlist",
      ask: "off",
    });

    expect(result.content[0]).toMatchObject({ type: "text" });
    const text = (result.content[0] as { text?: string }).text ?? "";
    expect(text).not.toMatch(/exec denied/i);
    expect(text).not.toMatch(/allowlist miss/i);
    expect(text.trim()).toContain("hello");
  });

  it("still enforces allowlist when configured security=allowlist and model passes allowlist", async () => {
    // When the configured security is already allowlist, the behavior should be
    // unchanged — a command not on the allowlist should still be denied.
    const tool = createExecTool({
      security: "allowlist",
      ask: "off",
      safeBins: [],
    });

    await expect(
      tool.execute("call-2", {
        command: isWin ? "echo hello" : "echo hello",
        security: "allowlist",
        ask: "off",
      }),
    ).rejects.toThrow(/exec denied: allowlist miss/i);
  });
});
