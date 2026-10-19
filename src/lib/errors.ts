/** Raised when the database cannot be reached. Callers show the clinic phone fallback. */
export class DatabaseUnavailableError extends Error {
  constructor(cause?: unknown) {
    super("Database unavailable");
    this.name = "DatabaseUnavailableError";
    this.cause = cause;
  }
}

const CONNECTION_CODES = new Set([
  "ECONNREFUSED",
  "ENOTFOUND",
  "ETIMEDOUT",
  "ECONNRESET",
  "57P01", // admin_shutdown
  "57P03", // cannot_connect_now
  "53300", // too_many_connections
  "3D000", // invalid_catalog_name (database does not exist)
  "28P01", // invalid_password
]);

function isConnectionError(err: unknown): boolean {
  let e: unknown = err;
  for (let depth = 0; e && depth < 4; depth++) {
    const code = (e as { code?: string }).code;
    if (code && CONNECTION_CODES.has(code)) return true;
    const msg = String((e as { message?: string }).message ?? "");
    if (/connection terminated|timeout exceeded when trying to connect|connect ECONNREFUSED/i.test(msg))
      return true;
    e = (e as { cause?: unknown }).cause;
  }
  return false;
}

/** Runs a DB operation and converts connectivity failures into DatabaseUnavailableError. */
export async function withDb<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof DatabaseUnavailableError) throw err;
    if (isConnectionError(err)) throw new DatabaseUnavailableError(err);
    throw err;
  }
}
