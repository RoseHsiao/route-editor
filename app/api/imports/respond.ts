import "server-only";

import { UnauthenticatedError } from "@/lib/auth/current-user";
import { UploadValidationError } from "@/lib/import/upload";
import { ImportConflictError, ImportNotFoundError } from "@/services/trail-data/imports";

/** Maps service errors to JSON responses. Unexpected errors never expose internals. */
export function errorResponse(error: unknown): Response {
  if (error instanceof UnauthenticatedError) {
    return Response.json({ error: { code: "UNAUTHENTICATED", message: "Sign in to import routes." } }, { status: 401 });
  }
  if (error instanceof UploadValidationError) {
    return Response.json(
      { error: { code: "INVALID_REQUEST", message: error.message, fields: error.fieldErrors } },
      { status: 422 },
    );
  }
  if (error instanceof ImportNotFoundError) {
    return Response.json({ error: { code: "NOT_FOUND", message: error.message } }, { status: 404 });
  }
  if (error instanceof ImportConflictError) {
    return Response.json({ error: { code: "CONFLICT", message: error.message } }, { status: 409 });
  }
  console.error("import request failed", error);
  return Response.json({ error: { code: "INTERNAL_ERROR", message: "The request failed." } }, { status: 500 });
}

export async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const body: unknown = await request.json();
    if (body && typeof body === "object" && !Array.isArray(body)) return body as Record<string, unknown>;
  } catch {
    // Fall through.
  }
  throw new UploadValidationError({ form: "Expected a JSON object." });
}
