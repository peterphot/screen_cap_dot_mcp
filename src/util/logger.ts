/**
 * Logger utility that writes to stderr.
 *
 * stdout is reserved for the MCP stdio protocol, so all diagnostic
 * and debug output must go to stderr.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

let currentLevel: LogLevel = "info";

export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

export function getLogLevel(): LogLevel {
  return currentLevel;
}

export function resetLogLevel(): void {
  currentLevel = "info";
}


function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= LOG_LEVELS[currentLevel];
}

function formatMessage(level: LogLevel, message: string): string {
  const timestamp = new Date().toISOString();
  return `[${timestamp}] [${level.toUpperCase()}] ${message}`;
}

export function debug(message: string): void {
  if (shouldLog("debug")) {
    process.stderr.write(formatMessage("debug", message) + "\n");
  }
}

export function info(message: string): void {
  if (shouldLog("info")) {
    process.stderr.write(formatMessage("info", message) + "\n");
  }
}

export function warn(message: string): void {
  if (shouldLog("warn")) {
    process.stderr.write(formatMessage("warn", message) + "\n");
  }
}

export function error(message: string): void {
  if (shouldLog("error")) {
    process.stderr.write(formatMessage("error", message) + "\n");
  }
}

const logger = { debug, info, warn, error, setLogLevel, getLogLevel, resetLogLevel };
export default logger;
