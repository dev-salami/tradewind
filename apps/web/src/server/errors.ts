import "server-only";
export class ApiError extends Error { constructor(message: string, public status = 400) { super(message); } }
export class NotConfiguredError extends ApiError { constructor() { super("attester key not configured", 503); } }
export function jsonError(error: unknown) {
  return Response.json({ error: error instanceof ApiError ? error.message : "Verification service unavailable" }, { status: error instanceof ApiError ? error.status : 503 });
}
