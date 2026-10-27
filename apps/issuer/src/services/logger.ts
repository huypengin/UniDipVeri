import { appendFileSync } from "node:fs";

/**
 * Resolves the destination log file path if configured via environment variable or CLI argument.
 */
export function getLogFilePath(): string | undefined {
  if (process.env.LOG_FILE) {
    return process.env.LOG_FILE;
  }
  const args = process.argv;
  const idx = args.indexOf("--log-file");
  if (idx !== -1 && idx + 1 < args.length) {
    return args[idx + 1];
  }
  return undefined;
}

/**
 * Returns true if ISO timestamp prefixes should be attached to logs.
 */
export function shouldLogTimestamps(): boolean {
  return (
    process.env.LOG_TIMESTAMPS === "true" ||
    process.env.LOG_TIMESTAMPS === "1" ||
    !!getLogFilePath()
  );
}

/**
 * Writes an application log line to console.log and optionally appends to the configured log file
 * with an optional ISO timestamp prefix.
 *
 * @param line Log line string
 */
export function writeIssuerLog(line: string): void {
  const ts = shouldLogTimestamps() ? `[${new Date().toISOString()}] ` : "";
  const fullLine = `${ts}${line}`;
  console.log(fullLine);
  const logFile = getLogFilePath();
  if (logFile) {
    try {
      appendFileSync(logFile, `${fullLine}\n`);
    } catch {
      // ignore write error
    }
  }
}
