/**
 * Tests that a model-supplied security argument cannot downgrade the operator's
 * configured exec security policy. configuredSecurity is always the floor.
 *
 * Regression test for: Codex models (gpt-5.4-mini etc.) routinely pass
 * security:"allowlist" or security:"deny" in their exec tool call arguments.
 * Before this fix, minSecurity(configuredSecurity, requestedSecurity) would
 * let the model's arg win, causing unexpected denials or policy bypass.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { captureEnv } from "../test-utils/env.js";
import { resetProcessRegistryForTests } from "./bash-process-registry.js";
import { createExecTool } from "./bash-tools.exec.js";
import { resolveShellFromPath } from "./shell-utils.js";

const isWin = process.platform === "win32";
const defaultShell = isWin
  ? undefined
  : process.env.OPENCLAW_TEST_SHELL || resolveShellFromPath("bash") || process.env.SHELL || "sh";

describe("exec security floor: configuredSecurity is always the operator floor", () => {
  let envSnapshot: ReturnType<typeof captureEnv>;

  beforeEach(() => {
    envSnapshot = captureEnv(["SHELL"]);
    if (!isWin && defaultShell) {
      process.env.SHELL = defaultShell;
    }
    resetProcessRegistryForTests();
  });

  afterEach(() => {
    envSnapshot.restore();
  });

  it("executes successfully when configured=full and model passes security=allowlist", async () => {
    // Codex models routinely pass security:"allowlist". With configured="full",
    // the command should run without hitting an allowlist check.
    const tool = createExecTool({
      security: "full",
      ask: "off",
    });

    const result = await tool.execute("call-1", {
      command: "echo hello",
      security: "allowlist", // model-supplied downgrade attempt
      ask: "off",
    });

    expect(result.content[0]).toMatchObject({ type: "text" });
    const text = (result.content[0] as { text?: string }).text ?? "";
    expect(text).not.toMatch(/exec denied/i);
    expect(text).not.toMatch(/allowlist miss/i);
    expect(text.trim()).toContain("hello");
  });

  it("enforces allowlist when configured=allowlist and model also passes allowlist", async () => {
    // When the operator configures allowlist, a command not on the list should
    // still be denied — the model passing the same security level doesn't bypass it.
    const tool = createExecTool({
      security: "allowlist",
      ask: "off",
      safeBins: [],
    });

    await expect(
      tool.execute("call-2", {
        command: "echo hello",
        security: "allowlist",
        ask: "off",
      }),
    ).rejects.toThrow(/exec denied: allowlist miss/i);
  });

  it("does not let model pass security=deny to block an allowlist-configured agent", async () => {
    // Model passing security:"deny" should not override an operator-configured
    // "allowlist" policy — configuredSecurity is always the floor.
    // The configured policy is "allowlist" + empty safeBins, so it should deny
    // with allowlist-miss (not "security=deny"), confirming the model's "deny"
    // was not honored as a blanket block.
    const tool = createExecTool({
      security: "allowlist",
      ask: "off",
      safeBins: [],
    });

    await expect(
      tool.execute("call-3", {
        command: "echo hello",
        security: "deny", // model trying to deny all execution
        ask: "off",
      }),
    ).rejects.toThrow(/exec denied: allowlist miss/i); // allowlist behavior, not hard deny
  });
});
