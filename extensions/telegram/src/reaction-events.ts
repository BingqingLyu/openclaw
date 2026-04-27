import {
  normalizeTelegramReactionKey,
  type TelegramReactionSemanticAction,
  type TelegramReactionSemanticsConfig,
} from "openclaw/plugin-sdk/config-runtime";

type TelegramRawReaction = {
  type?: unknown;
  emoji?: unknown;
  custom_emoji_id?: unknown;
};

export type NormalizedTelegramReaction = {
  key: string;
  label: string;
  type: "emoji" | "custom_emoji";
  emoji?: string;
  customEmojiId?: string;
};

export type ResolvedTelegramReactionSemantic = {
  action: TelegramReactionSemanticAction;
  meaning?: string;
  instruction?: string;
};

const DEFAULT_MAPPED_REACTION_ACTION: TelegramReactionSemanticAction = "wake";

function trimString(value: unknown): string | undefined {
  return typeof value === "string" ? value.trim() || undefined : undefined;
}

export { normalizeTelegramReactionKey };

export function normalizeTelegramReaction(reaction: unknown): NormalizedTelegramReaction | null {
  if (!reaction || typeof reaction !== "object") {
    return null;
  }

  const typedReaction = reaction as TelegramRawReaction;
  if (typedReaction.type === "emoji") {
    const emoji = trimString(typedReaction.emoji);
    if (!emoji) {
      return null;
    }
    return {
      key: `emoji:${emoji}`,
      label: emoji,
      type: "emoji",
      emoji,
    };
  }

  if (typedReaction.type === "custom_emoji") {
    const customEmojiId = trimString(typedReaction.custom_emoji_id);
    if (!customEmojiId) {
      return null;
    }
    return {
      key: `custom_emoji:${customEmojiId}`,
      label: `custom_emoji:${customEmojiId}`,
      type: "custom_emoji",
      customEmojiId,
    };
  }

  return null;
}

export function collectAddedTelegramReactions(params: {
  oldReactions?: ReadonlyArray<unknown>;
  newReactions?: ReadonlyArray<unknown>;
}): NormalizedTelegramReaction[] {
  const oldKeys = new Set(
    (params.oldReactions ?? [])
      .map((reaction) => normalizeTelegramReaction(reaction)?.key)
      .filter((key): key is string => Boolean(key)),
  );
  const seen = new Set<string>();
  const added: NormalizedTelegramReaction[] = [];

  for (const reaction of params.newReactions ?? []) {
    const normalized = normalizeTelegramReaction(reaction);
    if (!normalized || oldKeys.has(normalized.key) || seen.has(normalized.key)) {
      continue;
    }
    seen.add(normalized.key);
    added.push(normalized);
  }

  return added;
}

function resolveTelegramReactionSemanticEntry(
  value: TelegramReactionSemanticsConfig[string],
): ResolvedTelegramReactionSemantic | null {
  if (typeof value === "string") {
    const meaning = value.trim();
    return {
      action: DEFAULT_MAPPED_REACTION_ACTION,
      ...(meaning ? { meaning } : {}),
    };
  }

  if (!value || typeof value !== "object") {
    return null;
  }

  const meaning = trimString(value.meaning);
  const instruction = trimString(value.instruction);
  return {
    action: value.action ?? DEFAULT_MAPPED_REACTION_ACTION,
    ...(meaning ? { meaning } : {}),
    ...(instruction ? { instruction } : {}),
  };
}

export function resolveTelegramReactionSemantic(params: {
  reaction: NormalizedTelegramReaction;
  semantics?: TelegramReactionSemanticsConfig;
}): ResolvedTelegramReactionSemantic | undefined {
  const semantics = params.semantics;
  if (!semantics) {
    return undefined;
  }

  for (const [rawKey, rawValue] of Object.entries(semantics)) {
    const normalizedKey = normalizeTelegramReactionKey(rawKey);
    if (!normalizedKey || normalizedKey !== params.reaction.key) {
      continue;
    }
    return resolveTelegramReactionSemanticEntry(rawValue) ?? undefined;
  }

  return undefined;
}

export function buildTelegramReactionSystemEventText(params: {
  reaction: NormalizedTelegramReaction;
  actorLabel: string;
  messageId: number;
  semantic?: ResolvedTelegramReactionSemantic;
}): string {
  const meaning = params.semantic?.meaning?.trim();
  const prefix = meaning ? `Telegram reaction trigger: ${meaning}` : "Telegram reaction added:";
  const detail = meaning ? "" : ` ${params.reaction.label}`;
  const base = `${prefix}${detail} by ${params.actorLabel} on msg ${params.messageId} (reaction_key=${params.reaction.key})`;
  const instruction = params.semantic?.instruction?.trim();
  return instruction ? `${base}. ${instruction}` : base;
}
