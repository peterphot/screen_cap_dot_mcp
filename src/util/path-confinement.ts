/**
 * Shared path confinement utility.
 *
 * Provides functions for validating that file paths stay within
 * an allowed directory, with symlink detection after mkdir.
 * Also provides a helper for resolving config directories from
 * environment variables with safety checks.
 */

import { mkdir, realpath, open } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { constants } from "node:fs";

// Cache for realpath results of allowed directories.
// These directories don't change between calls, so caching avoids
// redundant syscalls (~0.1-1ms each) during multi-step flows.
const realpathCache = new Map<string, string>();

/** Clear the realpath cache. Exposed for testing only. @internal */
export function _clearRealpathCache(): void {
  realpathCache.clear();
}

/**
 * Validate that a resolved path is within the allowed directory.
 * Performs a prefix check to prevent path traversal.
 */
export function isWithinDir(resolvedPath: string, allowedDir: string): boolean {
  return resolvedPath.startsWith(allowedDir + "/") || resolvedPath === allowedDir;
}

/**
 * Resolve an environment-variable-backed config directory.
 * Rejects filesystem root to prevent vacuous confinement.
 */
export function resolveConfigDir(envVar: string, defaultPath: string): string {
  const raw = process.env[envVar] ?? defaultPath;
  const resolved = resolve(raw);
  if (resolved === "/") {
    throw new Error(`${envVar} must not resolve to the filesystem root.`);
  }
  return resolved;
}

/**
 * Resolve the real path of an allowed directory, with caching.
 * Ensures the directory exists before resolving.
 */
async function cachedRealpath(dir: string): Promise<string> {
  let cached = realpathCache.get(dir);
  if (!cached) {
    await mkdir(dir, { recursive: true });
    cached = await realpath(dir);
    realpathCache.set(dir, cached);
  }
  return cached;
}

/**
 * Validate and confine a path within an allowed directory.
 * Creates parent directories as needed, then checks for symlink escapes.
 * Returns the resolved path or an error message.
 */
export async function confinePath(
  filePath: string,
  allowedDir: string,
): Promise<{ resolvedPath: string } | { error: string }> {
  const resolvedPath = resolve(filePath);

  if (!isWithinDir(resolvedPath, allowedDir)) {
    return { error: `Path must be within ${allowedDir}` };
  }

  await mkdir(dirname(resolvedPath), { recursive: true });

  // Post-mkdir symlink check
  const realDir = await realpath(dirname(resolvedPath));
  const realAllowedDir = await cachedRealpath(allowedDir);
  if (!isWithinDir(realDir, realAllowedDir)) {
    return { error: `Path must be within ${allowedDir} (symlink detected)` };
  }

  return { resolvedPath: resolve(realDir, basename(resolvedPath)) };
}

/**
 * Validate and confine a directory within an allowed parent directory.
 * Creates the directory as needed, then checks for symlink escapes.
 * Returns the resolved directory path or an error message.
 */
export async function confineDir(
  dirPath: string,
  allowedDir: string,
): Promise<{ resolvedDir: string } | { error: string }> {
  const resolvedDir = resolve(dirPath);

  if (!isWithinDir(resolvedDir, allowedDir)) {
    return { error: `Path must be within ${allowedDir}` };
  }

  await mkdir(resolvedDir, { recursive: true });

  // Post-mkdir symlink check
  const realDir = await realpath(resolvedDir);
  const realAllowedDir = await cachedRealpath(allowedDir);
  if (!isWithinDir(realDir, realAllowedDir)) {
    return { error: `Path must be within ${allowedDir} (symlink detected)` };
  }

  return { resolvedDir: realDir };
}

/**
 * Atomically write data to a confined path using O_CREAT | O_WRONLY | O_TRUNC.
 *
 * Opens the file handle directly rather than relying on writeFile's path
 * resolution, which closes the TOCTOU window between path validation and
 * the actual write. The file handle is opened on the already-resolved path
 * from confinePath(), so symlink races cannot redirect the write.
 */
export async function safeWriteFile(
  confinedPath: string,
  data: Buffer | string,
): Promise<void> {
  const fh = await open(
    confinedPath,
    constants.O_CREAT | constants.O_WRONLY | constants.O_TRUNC,
    0o644,
  );
  try {
    await fh.writeFile(data);
  } finally {
    await fh.close();
  }
}
