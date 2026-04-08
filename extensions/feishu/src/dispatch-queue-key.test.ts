import { describe, it, expect } from "vitest";
import { resolveFeishuDispatchQueueKey } from "./dispatch-queue-key.js";

describe("resolveFeishuDispatchQueueKey", () => {
  // --- Basic queue key derivation ---

  it("returns chatId for a plain DM message (no topic)", () => {
    const key = resolveFeishuDispatchQueueKey({
      message: { chat_id: "oc_abc123", chat_type: "p2p" },
    });
    expect(key).toBe("oc_abc123");
  });

  it("returns chatId for a plain group message", () => {
    const key = resolveFeishuDispatchQueueKey({
      message: { chat_id: "oc_group1", chat_type: "group" },
    });
    expect(key).toBe("oc_group1");
  });

  it('returns "unknown" when chat_id is missing', () => {
    const key = resolveFeishuDispatchQueueKey({
      message: { chat_type: "p2p" },
    });
    expect(key).toBe("unknown");
  });

  // --- DM topic parallelism ---

  it("returns topic queue key for DM message with root_id", () => {
    const key = resolveFeishuDispatchQueueKey({
      message: {
        chat_id: "oc_dm1",
        chat_type: "p2p",
        root_id: "om_root_abc",
      },
    });
    expect(key).toBe("oc_dm1:topic:om_root_abc");
  });

  it("returns topic queue key for DM message with thread_id", () => {
    const key = resolveFeishuDispatchQueueKey({
      message: {
        chat_id: "oc_dm1",
        chat_type: "p2p",
        thread_id: "omt_thread_xyz",
      },
    });
    expect(key).toBe("oc_dm1:topic:omt_thread_xyz");
  });

  it("prefers root_id over thread_id for DM topic key", () => {
    const key = resolveFeishuDispatchQueueKey({
      message: {
        chat_id: "oc_dm1",
        chat_type: "p2p",
        root_id: "om_root_1",
        thread_id: "omt_thread_2",
      },
    });
    expect(key).toBe("oc_dm1:topic:om_root_1");
  });

  it("does NOT apply topic parallelism in group chats (groups have their own mechanism)", () => {
    const key = resolveFeishuDispatchQueueKey({
      message: {
        chat_id: "oc_group1",
        chat_type: "group",
        root_id: "om_root_group",
      },
    });
    expect(key).toBe("oc_group1");
  });

  it("ignores empty/whitespace root_id", () => {
    const key = resolveFeishuDispatchQueueKey({
      message: {
        chat_id: "oc_dm1",
        chat_type: "p2p",
        root_id: "  ",
      },
    });
    expect(key).toBe("oc_dm1");
  });

  it("handles private chat_type same as p2p", () => {
    const key = resolveFeishuDispatchQueueKey({
      message: {
        chat_id: "oc_priv1",
        chat_type: "private",
        root_id: "om_root_1",
      },
    });
    expect(key).toBe("oc_priv1:topic:om_root_1");
  });
});
