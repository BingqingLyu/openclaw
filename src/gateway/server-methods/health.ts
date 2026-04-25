import type { ChannelAccountSnapshot } from "../../channels/plugins/types.public.js";
import type {
  ChannelAccountHealthSummary,
  ChannelHealthSummary,
  HealthSummary,
} from "../../commands/health.types.js";
import { getStatusSummary } from "../../commands/status.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import type { ChannelRuntimeSnapshot } from "../server-channel-runtime.types.js";
import { HEALTH_REFRESH_INTERVAL_MS } from "../server-constants.js";
import { formatError } from "../server-utils.js";
import { formatForLog } from "../ws-log.js";
import type { GatewayRequestHandlers } from "./types.js";

const ADMIN_SCOPE = "operator.admin";

function mergeRuntimeAccountHealth(
  existing: ChannelAccountHealthSummary | undefined,
  runtime: ChannelAccountSnapshot,
): ChannelAccountHealthSummary {
  return {
    ...existing,
    ...runtime,
    accountId: runtime.accountId ?? existing?.accountId ?? "default",
  };
}

function mergeRuntimeChannelHealth(
  existing: ChannelHealthSummary | undefined,
  runtime: ChannelAccountSnapshot | undefined,
): ChannelHealthSummary {
  return {
    ...existing,
    ...runtime,
    accountId: runtime?.accountId ?? existing?.accountId ?? "default",
  };
}

function withLiveChannelRuntime(
  summary: HealthSummary,
  runtime: ChannelRuntimeSnapshot,
): HealthSummary {
  const channels: HealthSummary["channels"] = { ...summary.channels };
  const runtimeChannels = runtime.channels as Record<string, ChannelAccountSnapshot | undefined>;
  const runtimeAccountsByChannel = runtime.channelAccounts as Record<
    string,
    Record<string, ChannelAccountSnapshot> | undefined
  >;
  const channelIds = new Set([
    ...Object.keys(runtimeChannels),
    ...Object.keys(runtimeAccountsByChannel),
  ]);

  for (const channelId of channelIds) {
    const runtimeChannel = runtimeChannels[channelId];
    const runtimeAccounts = runtimeAccountsByChannel[channelId] ?? {};
    const existing = channels[channelId];
    const accounts: Record<string, ChannelAccountHealthSummary> = {
      ...existing?.accounts,
    };

    for (const [accountId, runtimeAccount] of Object.entries(runtimeAccounts)) {
      accounts[accountId] = mergeRuntimeAccountHealth(accounts[accountId], runtimeAccount);
    }

    channels[channelId] = {
      ...mergeRuntimeChannelHealth(existing, runtimeChannel),
      accounts,
    };
  }

  return { ...summary, channels };
}

export const healthHandlers: GatewayRequestHandlers = {
  health: async ({ respond, context, params }) => {
    const { getHealthCache, refreshHealthSnapshot, logHealth } = context;
    const wantsProbe = params?.probe === true;
    const now = Date.now();
    const cached = getHealthCache();
    if (!wantsProbe && cached && now - cached.ts < HEALTH_REFRESH_INTERVAL_MS) {
      respond(true, withLiveChannelRuntime(cached, context.getRuntimeSnapshot()), undefined, {
        cached: true,
      });
      void refreshHealthSnapshot({ probe: false }).catch((err) =>
        logHealth.error(`background health refresh failed: ${formatError(err)}`),
      );
      return;
    }
    try {
      const snap = await refreshHealthSnapshot({ probe: wantsProbe });
      respond(true, withLiveChannelRuntime(snap, context.getRuntimeSnapshot()), undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, formatForLog(err)));
    }
  },
  status: async ({ respond, client }) => {
    const scopes = Array.isArray(client?.connect?.scopes) ? client.connect.scopes : [];
    const status = await getStatusSummary({
      includeSensitive: scopes.includes(ADMIN_SCOPE),
    });
    respond(true, status, undefined);
  },
};
