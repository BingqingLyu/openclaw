import { beforeEach, describe, expect, it, vi } from "vitest";
import { SUBAGENT_ENDED_REASON_COMPLETE } from "./subagent-lifecycle-events.js";
import { createSubagentRegistryLifecycleController } from "./subagent-registry-lifecycle.js";
import type { SubagentRunRecord } from "./subagent-registry.types.js";

const taskExecutorMocks = vi.hoisted(() => ({
  completeTaskRunByRunId: vi.fn(),
  failTaskRunByRunId: vi.fn(),
  setDetachedTaskDeliveryStatusByRunId: vi.fn(),
}));

const helperMocks = vi.hoisted(() => ({
  persistSubagentSessionTiming: vi.fn(async () => {}),
  safeRemoveAttachmentsDir: vi.fn(async () => {}),
  logAnnounceGiveUp: vi.fn(),
}));

const runtimeMocks = vi.hoisted(() => ({
  log: vi.fn(),
}));

const lifecycleEventMocks = vi.hoisted(() => ({
  emitSessionLifecycleEvent: vi.fn(),
}));

const browserLifecycleCleanupMocks = vi.hoisted(() => ({
  cleanupBrowserSessionsForLifecycleEnd: vi.fn(async () => {}),
}));

vi.mock("../tasks/task-executor.js", () => ({
  completeTaskRunByRunId: taskExecutorMocks.completeTaskRunByRunId,
  failTaskRunByRunId: taskExecutorMocks.failTaskRunByRunId,
  setDetachedTaskDeliveryStatusByRunId: taskExecutorMocks.setDetachedTaskDeliveryStatusByRunId,
}));

vi.mock("../sessions/session-lifecycle-events.js", () => ({
  emitSessionLifecycleEvent: lifecycleEventMocks.emitSessionLifecycleEvent,
}));

vi.mock("../browser-lifecycle-cleanup.js", () => ({
  cleanupBrowserSessionsForLifecycleEnd:
    browserLifecycleCleanupMocks.cleanupBrowserSessionsForLifecycleEnd,
}));

vi.mock("../runtime.js", () => ({
  defaultRuntime: {
    log: runtimeMocks.log,
  },
}));

vi.mock("../utils/delivery-context.js", () => ({
  normalizeDeliveryContext: (origin: unknown) => origin ?? "agent",
}));

vi.mock("./subagent-announce.js", () => ({
  captureSubagentCompletionReply: vi.fn(async () => undefined),
  runSubagentAnnounceFlow: vi.fn(async () => false),
}));

vi.mock("./subagent-registry-cleanup.js", () => ({
  resolveCleanupCompletionReason: () => SUBAGENT_ENDED_REASON_COMPLETE,
  resolveDeferredCleanupDecision: () => ({ kind: "give-up", reason: "retry-limit" }),
}));

vi.mock("./subagent-registry-completion.js", () => ({
  runOutcomesEqual: (left: unknown, right: unknown) =>
    JSON.stringify(left) === JSON.stringify(right),
}));

vi.mock("./subagent-registry-helpers.js", () => ({
  ANNOUNCE_COMPLETION_HARD_EXPIRY_MS: 30 * 60_000,
  ANNOUNCE_EXPIRY_MS: 5 * 60_000,
  MAX_ANNOUNCE_RETRY_COUNT: 3,
  MIN_ANNOUNCE_RETRY_DELAY_MS: 1_000,
  capFrozenResultText: (text: string) => text.trim(),
  logAnnounceGiveUp: helperMocks.logAnnounceGiveUp,
  persistSubagentSessionTiming: helperMocks.persistSubagentSessionTiming,
  resolveAnnounceRetryDelayMs: (retryCount: number) =>
    Math.min(1_000 * 2 ** Math.max(0, retryCount - 1), 8_000),
  safeRemoveAttachmentsDir: helperMocks.safeRemoveAttachmentsDir,
}));

function createRunEntry(overrides: Partial<SubagentRunRecord> = {}): SubagentRunRecord {
  return {
    runId: "run-1",
    childSessionKey: "agent:main:subagent:child",
    requesterSessionKey: "agent:main:main",
    requesterDisplayKey: "main",
    task: "finish the task",
    cleanup: "keep",
    createdAt: 1_000,
    startedAt: 2_000,
    ...overrides,
  };
}

describe("subagent registry lifecycle hardening", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    browserLifecycleCleanupMocks.cleanupBrowserSessionsForLifecycleEnd.mockClear();
  });

  it("does not reject completion when task finalization throws", async () => {
    const persist = vi.fn();
    const warn = vi.fn();
    const entry = createRunEntry();
    const runs = new Map([[entry.runId, entry]]);
    taskExecutorMocks.completeTaskRunByRunId.mockImplementation(() => {
      throw new Error("task store boom");
    });

    const controller = createSubagentRegistryLifecycleController({
      runs,
      resumedRuns: new Set(),
      subagentAnnounceTimeoutMs: 1_000,
      persist,
      clearPendingLifecycleError: vi.fn(),
      countPendingDescendantRuns: () => 0,
      suppressAnnounceForSteerRestart: () => false,
      shouldEmitEndedHookForRun: () => false,
      emitSubagentEndedHookForRun: vi.fn(async () => {}),
      notifyContextEngineSubagentEnded: vi.fn(async () => {}),
      resumeSubagentRun: vi.fn(),
      captureSubagentCompletionReply: vi.fn(async () => "final completion reply"),
      runSubagentAnnounceFlow: vi.fn(async () => true),
      warn,
    });

    await expect(
      controller.completeSubagentRun({
        runId: entry.runId,
        endedAt: 4_000,
        outcome: { status: "ok" },
        reason: SUBAGENT_ENDED_REASON_COMPLETE,
        triggerCleanup: false,
      }),
    ).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalledWith(
      "failed to finalize subagent background task state",
      expect.objectContaining({
        error: { name: "Error", message: "task store boom" },
        runId: "***",
        childSessionKey: "agent:main:…",
        outcomeStatus: "ok",
      }),
    );
    expect(helperMocks.persistSubagentSessionTiming).toHaveBeenCalledTimes(1);
    expect(lifecycleEventMocks.emitSessionLifecycleEvent).toHaveBeenCalledWith({
      sessionKey: "agent:main:subagent:child",
      reason: "subagent-status",
      parentSessionKey: "agent:main:main",
      label: undefined,
    });
  });

  it("does not reject cleanup give-up when task delivery status update throws", async () => {
    const persist = vi.fn();
    const warn = vi.fn();
    const entry = createRunEntry({
      endedAt: 4_000,
      expectsCompletionMessage: false,
      retainAttachmentsOnKeep: true,
    });
    taskExecutorMocks.setDetachedTaskDeliveryStatusByRunId.mockImplementation(() => {
      throw new Error("delivery state boom");
    });

    const controller = createSubagentRegistryLifecycleController({
      runs: new Map([[entry.runId, entry]]),
      resumedRuns: new Set(),
      subagentAnnounceTimeoutMs: 1_000,
      persist,
      clearPendingLifecycleError: vi.fn(),
      countPendingDescendantRuns: () => 0,
      suppressAnnounceForSteerRestart: () => false,
      shouldEmitEndedHookForRun: () => false,
      emitSubagentEndedHookForRun: vi.fn(async () => {}),
      notifyContextEngineSubagentEnded: vi.fn(async () => {}),
      resumeSubagentRun: vi.fn(),
      captureSubagentCompletionReply: vi.fn(async () => undefined),
      runSubagentAnnounceFlow: vi.fn(async () => true),
      warn,
    });

    await expect(
      controller.finalizeResumedAnnounceGiveUp({
        runId: entry.runId,
        entry,
        reason: "retry-limit",
      }),
    ).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalledWith(
      "failed to update subagent background task delivery state",
      expect.objectContaining({
        error: { name: "Error", message: "delivery state boom" },
        runId: "***",
        childSessionKey: "agent:main:…",
        deliveryStatus: "failed",
      }),
    );
    expect(entry.cleanupCompletedAt).toBeTypeOf("number");
    expect(persist).toHaveBeenCalled();
  });

  it("cleans up tracked browser sessions before subagent cleanup flow", async () => {
    const persist = vi.fn();
    const entry = createRunEntry({
      expectsCompletionMessage: false,
    });
    const runSubagentAnnounceFlow = vi.fn(async () => true);

    const controller = createSubagentRegistryLifecycleController({
      runs: new Map([[entry.runId, entry]]),
      resumedRuns: new Set(),
      subagentAnnounceTimeoutMs: 1_000,
      persist,
      clearPendingLifecycleError: vi.fn(),
      countPendingDescendantRuns: () => 0,
      suppressAnnounceForSteerRestart: () => false,
      shouldEmitEndedHookForRun: () => false,
      emitSubagentEndedHookForRun: vi.fn(async () => {}),
      notifyContextEngineSubagentEnded: vi.fn(async () => {}),
      resumeSubagentRun: vi.fn(),
      captureSubagentCompletionReply: vi.fn(async () => "final completion reply"),
      runSubagentAnnounceFlow,
      warn: vi.fn(),
    });

    await expect(
      controller.completeSubagentRun({
        runId: entry.runId,
        endedAt: 4_000,
        outcome: { status: "ok" },
        reason: SUBAGENT_ENDED_REASON_COMPLETE,
        triggerCleanup: true,
      }),
    ).resolves.toBeUndefined();

    expect(browserLifecycleCleanupMocks.cleanupBrowserSessionsForLifecycleEnd).toHaveBeenCalledWith(
      {
        sessionKeys: [entry.childSessionKey],
        onWarn: expect.any(Function),
      },
    );
    expect(runSubagentAnnounceFlow).toHaveBeenCalledWith(
      expect.objectContaining({
        childSessionKey: entry.childSessionKey,
      }),
    );
  });

  it("reuses durable pending final delivery payload on resumed cleanup retries", async () => {
    const persist = vi.fn();
    const entry = createRunEntry({
      runId: "run-resume-pending",
      requesterSessionKey: "agent:main:main",
      requesterDisplayKey: "main",
      task: "stale live task should not be reused",
      label: "stale live label",
      startedAt: 2_000,
      endedAt: 4_000,
      outcome: { status: "timeout" },
      expectsCompletionMessage: true,
      pendingFinalDelivery: true,
      pendingFinalDeliveryCreatedAt: 3_900,
      pendingFinalDeliveryLastAttemptAt: 3_950,
      pendingFinalDeliveryAttemptCount: 1,
      pendingFinalDeliveryLastError: "direct failed",
      pendingFinalDeliveryPayload: {
        requesterSessionKey: "agent:main:restored-parent",
        requesterOrigin: { channel: "whatsapp", to: "+905000000000", accountId: "acct-r" },
        requesterDisplayKey: "restored-parent",
        childSessionKey: "agent:main:subagent:child",
        childRunId: "run-resume-pending",
        task: "restored durable task",
        label: "restored durable label",
        startedAt: 123,
        endedAt: 456,
        outcome: { status: "ok" },
        expectsCompletionMessage: true,
        spawnMode: "run",
        frozenResultText: "durable frozen reply",
        fallbackFrozenResultText: "durable fallback reply",
        wakeOnDescendantSettle: true,
      },
    });
    const runSubagentAnnounceFlow = vi.fn(async () => false);

    const controller = createSubagentRegistryLifecycleController({
      runs: new Map([[entry.runId, entry]]),
      resumedRuns: new Set(),
      subagentAnnounceTimeoutMs: 1_000,
      persist,
      clearPendingLifecycleError: vi.fn(),
      countPendingDescendantRuns: () => 0,
      suppressAnnounceForSteerRestart: () => false,
      shouldEmitEndedHookForRun: () => false,
      emitSubagentEndedHookForRun: vi.fn(async () => {}),
      notifyContextEngineSubagentEnded: vi.fn(async () => {}),
      resumeSubagentRun: vi.fn(),
      captureSubagentCompletionReply: vi.fn(async () => undefined),
      runSubagentAnnounceFlow,
      warn: vi.fn(),
    });

    expect(controller.startSubagentAnnounceCleanupFlow(entry.runId, entry)).toBe(true);
    await Promise.resolve();
    await Promise.resolve();

    expect(runSubagentAnnounceFlow).toHaveBeenCalledWith(
      expect.objectContaining({
        childSessionKey: "agent:main:subagent:child",
        childRunId: "run-resume-pending",
        requesterSessionKey: "agent:main:restored-parent",
        requesterOrigin: { channel: "whatsapp", to: "+905000000000", accountId: "acct-r" },
        requesterDisplayKey: "restored-parent",
        task: "restored durable task",
        label: "restored durable label",
        roundOneReply: "durable frozen reply",
        fallbackReply: "durable fallback reply",
        startedAt: 123,
        endedAt: 456,
        outcome: { status: "ok" },
        expectsCompletionMessage: true,
        wakeOnDescendantSettle: true,
      }),
    );
  });

  it("ignores stale pending final delivery payload when it belongs to a different run", async () => {
    const persist = vi.fn();
    const entry = createRunEntry({
      runId: "run-current",
      childSessionKey: "agent:main:subagent:current-child",
      requesterSessionKey: "agent:main:current-parent",
      requesterDisplayKey: "current-parent",
      task: "current task",
      label: "current label",
      startedAt: 2_000,
      endedAt: 4_000,
      outcome: { status: "ok" },
      expectsCompletionMessage: true,
      pendingFinalDelivery: true,
      pendingFinalDeliveryCreatedAt: 3_900,
      pendingFinalDeliveryLastAttemptAt: 3_950,
      pendingFinalDeliveryAttemptCount: 1,
      pendingFinalDeliveryLastError: "direct failed",
      pendingFinalDeliveryPayload: {
        requesterSessionKey: "agent:main:stale-parent",
        requesterOrigin: { channel: "whatsapp", to: "+905000000000", accountId: "acct-stale" },
        requesterDisplayKey: "stale-parent",
        childSessionKey: "agent:main:subagent:stale-child",
        childRunId: "run-stale",
        task: "stale durable task",
        label: "stale durable label",
        startedAt: 123,
        endedAt: 456,
        outcome: { status: "error", error: "stale" },
        expectsCompletionMessage: false,
        spawnMode: "run",
        frozenResultText: "stale frozen reply",
        fallbackFrozenResultText: "stale fallback reply",
        wakeOnDescendantSettle: true,
      },
    });
    const runSubagentAnnounceFlow = vi.fn(async () => false);

    const controller = createSubagentRegistryLifecycleController({
      runs: new Map([[entry.runId, entry]]),
      resumedRuns: new Set(),
      subagentAnnounceTimeoutMs: 1_000,
      persist,
      clearPendingLifecycleError: vi.fn(),
      countPendingDescendantRuns: () => 0,
      suppressAnnounceForSteerRestart: () => false,
      shouldEmitEndedHookForRun: () => false,
      emitSubagentEndedHookForRun: vi.fn(async () => {}),
      notifyContextEngineSubagentEnded: vi.fn(async () => {}),
      resumeSubagentRun: vi.fn(),
      captureSubagentCompletionReply: vi.fn(async () => undefined),
      runSubagentAnnounceFlow,
      warn: vi.fn(),
    });

    expect(controller.startSubagentAnnounceCleanupFlow(entry.runId, entry)).toBe(true);
    await Promise.resolve();
    await Promise.resolve();

    expect(runSubagentAnnounceFlow).toHaveBeenCalledWith(
      expect.objectContaining({
        childSessionKey: "agent:main:subagent:current-child",
        childRunId: "run-current",
        requesterSessionKey: "agent:main:current-parent",
        requesterOrigin: "agent",
        requesterDisplayKey: "current-parent",
        task: "current task",
        label: "current label",
        startedAt: 2_000,
        endedAt: 4_000,
        outcome: { status: "ok" },
        expectsCompletionMessage: true,
        roundOneReply: undefined,
        fallbackReply: undefined,
        wakeOnDescendantSettle: false,
      }),
    );
  });

  it("prefers newer live frozen result text over stale durable retry payload", async () => {
    const persist = vi.fn();
    const entry = createRunEntry({
      runId: "run-live-frozen",
      requesterSessionKey: "agent:main:main",
      requesterDisplayKey: "main",
      task: "live frozen task",
      label: "live frozen label",
      startedAt: 2_000,
      endedAt: 4_000,
      outcome: { status: "ok" },
      expectsCompletionMessage: true,
      frozenResultText: "newer live frozen reply",
      pendingFinalDelivery: true,
      pendingFinalDeliveryCreatedAt: 3_900,
      pendingFinalDeliveryLastAttemptAt: 3_950,
      pendingFinalDeliveryAttemptCount: 1,
      pendingFinalDeliveryLastError: "direct failed",
      pendingFinalDeliveryPayload: {
        requesterSessionKey: "agent:main:restored-parent",
        requesterOrigin: { channel: "whatsapp", to: "+905000000000", accountId: "acct-r" },
        requesterDisplayKey: "restored-parent",
        childSessionKey: "agent:main:subagent:child",
        childRunId: "run-live-frozen",
        task: "restored durable task",
        label: "restored durable label",
        startedAt: 123,
        endedAt: 456,
        outcome: { status: "ok" },
        expectsCompletionMessage: true,
        spawnMode: "run",
        frozenResultText: "stale durable frozen reply",
        fallbackFrozenResultText: "durable fallback reply",
        wakeOnDescendantSettle: true,
      },
    });
    const runSubagentAnnounceFlow = vi.fn(async () => false);

    const controller = createSubagentRegistryLifecycleController({
      runs: new Map([[entry.runId, entry]]),
      resumedRuns: new Set(),
      subagentAnnounceTimeoutMs: 1_000,
      persist,
      clearPendingLifecycleError: vi.fn(),
      countPendingDescendantRuns: () => 0,
      suppressAnnounceForSteerRestart: () => false,
      shouldEmitEndedHookForRun: () => false,
      emitSubagentEndedHookForRun: vi.fn(async () => {}),
      notifyContextEngineSubagentEnded: vi.fn(async () => {}),
      resumeSubagentRun: vi.fn(),
      captureSubagentCompletionReply: vi.fn(async () => undefined),
      runSubagentAnnounceFlow,
      warn: vi.fn(),
    });

    expect(controller.startSubagentAnnounceCleanupFlow(entry.runId, entry)).toBe(true);
    await Promise.resolve();
    await Promise.resolve();

    expect(runSubagentAnnounceFlow).toHaveBeenCalledWith(
      expect.objectContaining({
        childSessionKey: "agent:main:subagent:child",
        childRunId: "run-live-frozen",
        requesterSessionKey: "agent:main:restored-parent",
        requesterDisplayKey: "restored-parent",
        task: "restored durable task",
        label: "restored durable label",
        roundOneReply: "newer live frozen reply",
        fallbackReply: "durable fallback reply",
        wakeOnDescendantSettle: true,
      }),
    );
  });

  it("clears pending final delivery state when give-up finalization runs", async () => {
    const persist = vi.fn();
    const entry = createRunEntry({
      endedAt: 4_000,
      expectsCompletionMessage: false,
      pendingFinalDelivery: true,
      pendingFinalDeliveryCreatedAt: 3_900,
      pendingFinalDeliveryLastAttemptAt: 3_950,
      pendingFinalDeliveryAttemptCount: 2,
      pendingFinalDeliveryLastError: "resume delivery deferred",
      pendingFinalDeliveryPayload: {
        requesterSessionKey: "agent:main:main",
        requesterDisplayKey: "main",
        childSessionKey: "agent:main:subagent:child",
        childRunId: "run-1",
        task: "finish the task",
      },
    });

    const controller = createSubagentRegistryLifecycleController({
      runs: new Map([[entry.runId, entry]]),
      resumedRuns: new Set(),
      subagentAnnounceTimeoutMs: 1_000,
      persist,
      clearPendingLifecycleError: vi.fn(),
      countPendingDescendantRuns: () => 0,
      suppressAnnounceForSteerRestart: () => false,
      shouldEmitEndedHookForRun: () => false,
      emitSubagentEndedHookForRun: vi.fn(async () => {}),
      notifyContextEngineSubagentEnded: vi.fn(async () => {}),
      resumeSubagentRun: vi.fn(),
      captureSubagentCompletionReply: vi.fn(async () => undefined),
      runSubagentAnnounceFlow: vi.fn(async () => true),
      warn: vi.fn(),
    });

    await expect(
      controller.finalizeResumedAnnounceGiveUp({
        runId: entry.runId,
        entry,
        reason: "retry-limit",
      }),
    ).resolves.toBeUndefined();

    expect(entry.pendingFinalDelivery).toBeUndefined();
    expect(entry.pendingFinalDeliveryCreatedAt).toBeUndefined();
    expect(entry.pendingFinalDeliveryLastAttemptAt).toBeUndefined();
    expect(entry.pendingFinalDeliveryAttemptCount).toBeUndefined();
    expect(entry.pendingFinalDeliveryLastError).toBeUndefined();
    expect(entry.pendingFinalDeliveryPayload).toBeUndefined();
  });

  it("does not wait for a completion reply when the run does not expect one", async () => {
    const entry = createRunEntry({
      expectsCompletionMessage: false,
    });
    const captureSubagentCompletionReply = vi.fn(async () => undefined);

    const controller = createSubagentRegistryLifecycleController({
      runs: new Map([[entry.runId, entry]]),
      resumedRuns: new Set(),
      subagentAnnounceTimeoutMs: 1_000,
      persist: vi.fn(),
      clearPendingLifecycleError: vi.fn(),
      countPendingDescendantRuns: () => 0,
      suppressAnnounceForSteerRestart: () => false,
      shouldEmitEndedHookForRun: () => false,
      emitSubagentEndedHookForRun: vi.fn(async () => {}),
      notifyContextEngineSubagentEnded: vi.fn(async () => {}),
      resumeSubagentRun: vi.fn(),
      captureSubagentCompletionReply,
      runSubagentAnnounceFlow: vi.fn(async () => false),
      warn: vi.fn(),
    });

    await expect(
      controller.completeSubagentRun({
        runId: entry.runId,
        endedAt: 4_000,
        outcome: { status: "ok" },
        reason: SUBAGENT_ENDED_REASON_COMPLETE,
        triggerCleanup: false,
      }),
    ).resolves.toBeUndefined();

    expect(captureSubagentCompletionReply).toHaveBeenCalledWith(entry.childSessionKey, {
      waitForReply: false,
    });
  });

  it("does not re-run announce flow after completion was already delivered", async () => {
    const entry = createRunEntry({
      completionAnnouncedAt: 3_500,
      endedAt: 4_000,
    });
    const persist = vi.fn();
    const runSubagentAnnounceFlow = vi.fn(async () => true);
    const notifyContextEngineSubagentEnded = vi.fn(async () => {});

    const controller = createSubagentRegistryLifecycleController({
      runs: new Map([[entry.runId, entry]]),
      resumedRuns: new Set(),
      subagentAnnounceTimeoutMs: 1_000,
      persist,
      clearPendingLifecycleError: vi.fn(),
      countPendingDescendantRuns: () => 0,
      suppressAnnounceForSteerRestart: () => false,
      shouldEmitEndedHookForRun: () => false,
      emitSubagentEndedHookForRun: vi.fn(async () => {}),
      notifyContextEngineSubagentEnded,
      resumeSubagentRun: vi.fn(),
      captureSubagentCompletionReply: vi.fn(async () => "final completion reply"),
      runSubagentAnnounceFlow,
      warn: vi.fn(),
    });

    await expect(
      controller.completeSubagentRun({
        runId: entry.runId,
        endedAt: 4_000,
        outcome: { status: "ok" },
        reason: SUBAGENT_ENDED_REASON_COMPLETE,
        triggerCleanup: true,
      }),
    ).resolves.toBeUndefined();

    expect(runSubagentAnnounceFlow).not.toHaveBeenCalled();
    expect(typeof entry.cleanupCompletedAt).toBe("number");
    expect(entry.cleanupCompletedAt).toBeGreaterThan(0);
    expect(notifyContextEngineSubagentEnded).toHaveBeenCalledWith({
      childSessionKey: entry.childSessionKey,
      reason: "completed",
      workspaceDir: entry.workspaceDir,
    });
    expect(persist).toHaveBeenCalled();
  });

  it("emits ended hook while retrying cleanup after completion was already delivered", async () => {
    const entry = createRunEntry({
      completionAnnouncedAt: 3_500,
      endedAt: 4_000,
      expectsCompletionMessage: true,
    });
    const emitSubagentEndedHookForRun = vi.fn(async () => {});

    const controller = createSubagentRegistryLifecycleController({
      runs: new Map([[entry.runId, entry]]),
      resumedRuns: new Set(),
      subagentAnnounceTimeoutMs: 1_000,
      persist: vi.fn(),
      clearPendingLifecycleError: vi.fn(),
      countPendingDescendantRuns: () => 0,
      suppressAnnounceForSteerRestart: () => false,
      shouldEmitEndedHookForRun: () => true,
      emitSubagentEndedHookForRun,
      notifyContextEngineSubagentEnded: vi.fn(async () => {}),
      resumeSubagentRun: vi.fn(),
      captureSubagentCompletionReply: vi.fn(async () => "final completion reply"),
      runSubagentAnnounceFlow: vi.fn(async () => true),
      warn: vi.fn(),
    });

    await expect(
      controller.completeSubagentRun({
        runId: entry.runId,
        endedAt: 4_000,
        outcome: { status: "ok" },
        reason: SUBAGENT_ENDED_REASON_COMPLETE,
        triggerCleanup: true,
      }),
    ).resolves.toBeUndefined();

    expect(emitSubagentEndedHookForRun).toHaveBeenCalledTimes(1);
    expect(emitSubagentEndedHookForRun).toHaveBeenCalledWith({
      entry,
      reason: SUBAGENT_ENDED_REASON_COMPLETE,
      sendFarewell: true,
    });
  });

  it("produces valid cleanupCompletedAt on give-up path when completionAnnouncedAt is undefined", async () => {
    const persist = vi.fn();
    const entry = createRunEntry({
      endedAt: 4_000,
      expectsCompletionMessage: false,
      retainAttachmentsOnKeep: true,
    });

    const controller = createSubagentRegistryLifecycleController({
      runs: new Map([[entry.runId, entry]]),
      resumedRuns: new Set(),
      subagentAnnounceTimeoutMs: 1_000,
      persist,
      clearPendingLifecycleError: vi.fn(),
      countPendingDescendantRuns: () => 0,
      suppressAnnounceForSteerRestart: () => false,
      shouldEmitEndedHookForRun: () => false,
      emitSubagentEndedHookForRun: vi.fn(async () => {}),
      notifyContextEngineSubagentEnded: vi.fn(async () => {}),
      resumeSubagentRun: vi.fn(),
      captureSubagentCompletionReply: vi.fn(async () => undefined),
      runSubagentAnnounceFlow: vi.fn(async () => true),
      warn: vi.fn(),
    });

    expect(entry.completionAnnouncedAt).toBeUndefined();

    await controller.finalizeResumedAnnounceGiveUp({
      runId: entry.runId,
      entry,
      reason: "retry-limit",
    });

    expect(entry.cleanupCompletedAt).toBeTypeOf("number");
    expect(Number.isNaN(entry.cleanupCompletedAt)).toBe(false);
  });

  it("continues cleanup when delivery-status persistence throws after announce delivery", async () => {
    const persist = vi.fn();
    const warn = vi.fn();
    const emitSubagentEndedHookForRun = vi.fn(async () => {});
    const entry = createRunEntry({
      endedAt: 4_000,
      expectsCompletionMessage: false,
      retainAttachmentsOnKeep: false,
    });
    taskExecutorMocks.setDetachedTaskDeliveryStatusByRunId.mockImplementation(() => {
      throw new Error("delivery status boom");
    });

    const controller = createSubagentRegistryLifecycleController({
      runs: new Map([[entry.runId, entry]]),
      resumedRuns: new Set(),
      subagentAnnounceTimeoutMs: 1_000,
      persist,
      clearPendingLifecycleError: vi.fn(),
      countPendingDescendantRuns: () => 0,
      suppressAnnounceForSteerRestart: () => false,
      shouldEmitEndedHookForRun: () => true,
      emitSubagentEndedHookForRun,
      notifyContextEngineSubagentEnded: vi.fn(async () => {}),
      resumeSubagentRun: vi.fn(),
      captureSubagentCompletionReply: vi.fn(async () => "final completion reply"),
      runSubagentAnnounceFlow: vi.fn(async () => true),
      warn,
    });

    await expect(
      controller.completeSubagentRun({
        runId: entry.runId,
        endedAt: 4_000,
        outcome: { status: "ok" },
        reason: SUBAGENT_ENDED_REASON_COMPLETE,
        triggerCleanup: true,
      }),
    ).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalledWith(
      "failed to update subagent background task delivery state",
      expect.objectContaining({
        error: { name: "Error", message: "delivery status boom" },
        deliveryStatus: "delivered",
      }),
    );
    expect(emitSubagentEndedHookForRun).toHaveBeenCalledTimes(1);
    expect(helperMocks.safeRemoveAttachmentsDir).toHaveBeenCalledTimes(1);
    expect(entry.cleanupCompletedAt).toBeTypeOf("number");
    expect(persist).toHaveBeenCalled();
  });

  it("skips browser cleanup when steer restart suppresses cleanup flow", async () => {
    const entry = createRunEntry({
      expectsCompletionMessage: false,
    });
    const runSubagentAnnounceFlow = vi.fn(async () => true);

    const controller = createSubagentRegistryLifecycleController({
      runs: new Map([[entry.runId, entry]]),
      resumedRuns: new Set(),
      subagentAnnounceTimeoutMs: 1_000,
      persist: vi.fn(),
      clearPendingLifecycleError: vi.fn(),
      countPendingDescendantRuns: () => 0,
      suppressAnnounceForSteerRestart: () => true,
      shouldEmitEndedHookForRun: () => false,
      emitSubagentEndedHookForRun: vi.fn(async () => {}),
      notifyContextEngineSubagentEnded: vi.fn(async () => {}),
      resumeSubagentRun: vi.fn(),
      captureSubagentCompletionReply: vi.fn(async () => "final completion reply"),
      runSubagentAnnounceFlow,
      warn: vi.fn(),
    });

    await expect(
      controller.completeSubagentRun({
        runId: entry.runId,
        endedAt: 4_000,
        outcome: { status: "ok" },
        reason: SUBAGENT_ENDED_REASON_COMPLETE,
        triggerCleanup: true,
      }),
    ).resolves.toBeUndefined();

    expect(
      browserLifecycleCleanupMocks.cleanupBrowserSessionsForLifecycleEnd,
    ).not.toHaveBeenCalled();
    expect(runSubagentAnnounceFlow).not.toHaveBeenCalled();
  });
});
