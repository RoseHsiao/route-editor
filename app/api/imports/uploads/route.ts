import { requireUser } from "@/lib/auth/current-user";
import { createDirectUpload } from "@/services/trail-data/imports";

import { errorResponse, readJson } from "../respond";

/**
 * Step 1 of a direct upload: returns a presigned URL bound to the file's SHA-256,
 * or `{ mode: "server" }` when storage cannot presign (local development).
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const user = await requireUser();
    const body = await readJson(request);
    const ticket = await createDirectUpload(user, {
      fileName: String(body.fileName ?? ""),
      sizeBytes: Number(body.sizeBytes ?? 0),
      sha256: String(body.sha256 ?? ""),
    });
    return Response.json(ticket);
  } catch (error) {
    return errorResponse(error);
  }
}
