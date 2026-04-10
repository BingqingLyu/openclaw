export type EmbeddedContextFile = { path: string; content: string };

export type FailoverReason =
  | "auth"
  | "auth_permanent"
  | "quota_exhausted"
  | "format"
  | "rate_limit"
  | "overloaded"
  | "billing"
  | "timeout"
  | "model_not_found"
  | "session_expired"
  | "unknown";
