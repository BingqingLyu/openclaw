import { describe, expect, it } from "vitest";
import { normalizeFeishuEmoji } from "./reactions.js";

describe("normalizeFeishuEmoji", () => {
  it("passes through known Feishu emoji type strings", () => {
    expect(normalizeFeishuEmoji("THUMBSUP")).toBe("THUMBSUP");
    expect(normalizeFeishuEmoji("HEART")).toBe("HEART");
    expect(normalizeFeishuEmoji("FIRE")).toBe("FIRE");
  });

  it("normalizes case-insensitive Feishu type strings", () => {
    expect(normalizeFeishuEmoji("thumbsup")).toBe("THUMBSUP");
    expect(normalizeFeishuEmoji("Heart")).toBe("HEART");
    expect(normalizeFeishuEmoji("fire")).toBe("FIRE");
  });

  it("converts common unicode emojis to Feishu types", () => {
    expect(normalizeFeishuEmoji("\u{1F44D}")).toBe("THUMBSUP");
    expect(normalizeFeishuEmoji("\u{1F44E}")).toBe("THUMBSDOWN");
    expect(normalizeFeishuEmoji("\u{2764}\u{FE0F}")).toBe("HEART");
    expect(normalizeFeishuEmoji("\u{2764}")).toBe("HEART");
    expect(normalizeFeishuEmoji("\u{1F525}")).toBe("FIRE");
    expect(normalizeFeishuEmoji("\u{1F389}")).toBe("PARTY");
    expect(normalizeFeishuEmoji("\u{1F44F}")).toBe("CLAP");
    expect(normalizeFeishuEmoji("\u{1F64F}")).toBe("PRAY");
    expect(normalizeFeishuEmoji("\u{274C}")).toBe("CROSS");
    expect(normalizeFeishuEmoji("\u{2705}")).toBe("CHECK");
  });

  it("trims whitespace before normalizing", () => {
    expect(normalizeFeishuEmoji("  THUMBSUP  ")).toBe("THUMBSUP");
    expect(normalizeFeishuEmoji(" \u{1F525} ")).toBe("FIRE");
  });

  it("returns unknown values unchanged for API-level error reporting", () => {
    expect(normalizeFeishuEmoji("UNKNOWN_EMOJI")).toBe("UNKNOWN_EMOJI");
    expect(normalizeFeishuEmoji("\u{1F923}")).toBe("\u{1F923}");
  });
});
