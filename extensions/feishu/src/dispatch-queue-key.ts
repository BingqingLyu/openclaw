/**
 * Derive the sequential dispatch queue key for a Feishu message event.
 *
 * DM messages that carry a `root_id` or `thread_id` (i.e. sent inside a
 * topic/thread) get a per-topic queue key (`<chatId>:topic:<topicId>`),
 * enabling parallel processing of independent DM threads.
 * Messages on the main DM surface share the flat `chatId` queue as before.
 *
 * Group messages are not altered here — group topic parallelism is handled
 * by the existing `resolveFeishuGroupSession` + per-peer-id queue logic.
 */
export function resolveFeishuDispatchQueueKey(event: {
  message: {
    chat_id?: string;
    chat_type?: string;
    root_id?: string;
    thread_id?: string;
  };
}): string {
  const chatId = event.message.chat_id?.trim() || "unknown";

  // DM topic parallelism: messages inside a thread get their own queue
  const isGroup = event.message.chat_type === "group";
  if (!isGroup) {
    const topicId = event.message.root_id?.trim() || event.message.thread_id?.trim();
    if (topicId) {
      return `${chatId}:topic:${topicId}`;
    }
  }

  return chatId;
}
