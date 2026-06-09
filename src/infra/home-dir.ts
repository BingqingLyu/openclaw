import os from "node:os";
import path from "node:path";

function normalize(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed || trimmed === "undefined" || trimmed === "null") {
    return undefined;
  }
  return trimmed;
}

function normalizeSafe(homedir: () => string): string | undefined {
  try {
    return normalize(homedir());
  } catch {
    return undefined;
  }
}

function resolveTermuxHome(env: NodeJS.ProcessEnv): string | undefined {
  const prefix = normalize(env.PREFIX);
  if (!prefix || !normalize(env.ANDROID_DATA)) {
    return undefined;
  }
  if (!/(?:^|\/)com\.termux\/files\/usr\/?$/u.test(prefix.replace(/\\/gu, "/"))) {
    return undefined;
  }
  return path.resolve(prefix, "..", "home");
}

function resolveRawOsHomeDir(env: NodeJS.ProcessEnv, homedir: () => string): string | undefined {
  return (
    normalize(env.HOME) ??
    normalize(env.USERPROFILE) ??
    resolveTermuxHome(env) ??
    normalizeSafe(homedir)
  );
}

function resolveRawHomeDir(env: NodeJS.ProcessEnv, homedir: () => string): string | undefined {
  const explicitHome = normalize(env.OPENCLAW_HOME);
  if (!explicitHome) {
    return resolveRawOsHomeDir(env, homedir);
  }
  if (explicitHome === "~" || explicitHome.startsWith("~/") || explicitHome.startsWith("~\\")) {
    const fallbackHome = resolveRawOsHomeDir(env, homedir);
    return fallbackHome ? explicitHome.replace(/^~(?=$|[\\/])/, fallbackHome) : undefined;
  }
  return explicitHome;
}

export function resolveEffectiveHomeDir(
  env: NodeJS.ProcessEnv = process.env,
  homedir: () => string = os.homedir,
): string | undefined {
  const raw = resolveRawHomeDir(env, homedir);
  return raw ? path.resolve(raw) : undefined;
}

export function resolveOsHomeDir(
  env: NodeJS.ProcessEnv = process.env,
  homedir: () => string = os.homedir,
): string | undefined {
  const raw = resolveRawOsHomeDir(env, homedir);
  return raw ? path.resolve(raw) : undefined;
}
export function resolveRequiredHomeDir(
  env: NodeJS.ProcessEnv = process.env,
  homedir: () => string = os.homedir,
): string {
  return resolveEffectiveHomeDir(env, homedir) ?? path.resolve(process.cwd());
}

export function resolveRequiredOsHomeDir(
  env: NodeJS.ProcessEnv = process.env,
  homedir: () => string = os.homedir,
): string {
  return resolveOsHomeDir(env, homedir) ?? path.resolve(process.cwd());
}

export function expandHomePrefix(
  input: string,
  opts?: {
    home?: string;
    env?: NodeJS.ProcessEnv;
    homedir?: () => string;
  },
): string {
  if (!input.startsWith("~")) {
    return input;
  }
  const home =
    normalize(opts?.home) ??
    resolveEffectiveHomeDir(opts?.env ?? process.env, opts?.homedir ?? os.homedir);
  if (!home) {
    return input;
  }
  return input.replace(/^~(?=$|[\\/])/, home);
}

/**
 * Expand `${VAR}` and `$VAR` references in a string using the provided
 * environment.  Unknown or empty variables are replaced with the empty string
 * so the caller never sees a literal `${…}` token in the resolved path.
 */
export function expandEnvVars(
  input: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  // Match ${VAR_NAME} (braced) and $VAR_NAME (unbraced, word-boundary).
  return input.replace(
    /\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g,
    (_match, braced: string | undefined, unbraced: string | undefined) => {
      const name = (braced ?? unbraced)!;
      return env[name]?.trim() ?? "";
    },
  );
}

export function resolveHomeRelativePath(
  input: string,
  opts?: {
    env?: NodeJS.ProcessEnv;
    homedir?: () => string;
  },
): string {
  const trimmed = input.trim();
  if (!trimmed) {
    return trimmed;
  }
  const env = opts?.env ?? process.env;
  // Expand environment variable references before resolving the path.
  const envExpanded = expandEnvVars(trimmed, env);
  if (envExpanded.startsWith("~")) {
    const expanded = expandHomePrefix(envExpanded, {
      home: resolveRequiredHomeDir(env, opts?.homedir ?? os.homedir),
      env: opts?.env,
      homedir: opts?.homedir,
    });
    return path.resolve(expanded);
  }
  return path.resolve(envExpanded);
}

export function resolveUserPath(
  input: string,
  env: NodeJS.ProcessEnv = process.env,
  homedir: () => string = os.homedir,
): string {
  return resolveHomeRelativePath(input, { env, homedir });
}

export function resolveOsHomeRelativePath(
  input: string,
  opts?: {
    env?: NodeJS.ProcessEnv;
    homedir?: () => string;
  },
): string {
  const trimmed = input.trim();
  if (!trimmed) {
    return trimmed;
  }
  const env = opts?.env ?? process.env;
  // Expand environment variable references before resolving the path.
  const envExpanded = expandEnvVars(trimmed, env);
  if (envExpanded.startsWith("~")) {
    const expanded = expandHomePrefix(envExpanded, {
      home: resolveRequiredOsHomeDir(env, opts?.homedir ?? os.homedir),
      env: opts?.env,
      homedir: opts?.homedir,
    });
    return path.resolve(expanded);
  }
  return path.resolve(envExpanded);
}
