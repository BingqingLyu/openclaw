import { describe, expect, it } from "vitest";
import { isControlCommandMessage } from "./command-detection.js";

describe("isControlCommandMessage", () => {
  it("accepts slash commands after leading mention tags", () => {
    expect(isControlCommandMessage('<at user_id="ou_bot">Bot</at> /reset')).toBe(true);
  });

  it("accepts slash commands after leading plain mentions", () => {
    expect(isControlCommandMessage("@Bot /reset")).toBe(true);
  });

  it("does not treat path-like slash text as a command after leading mentions", () => {
    expect(isControlCommandMessage('<at user_id="ou_bot">Bot</at> /tmp/project.log')).toBe(false);
  });
});
