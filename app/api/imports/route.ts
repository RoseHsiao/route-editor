import { requireUser } from "@/lib/auth/current-user";
import { GEO_CONTRACT } from "@/lib/import/contract";
import { UploadValidationError } from "@/lib/import/upload";
import { createImportFromUpload } from "@/services/trail-data/imports";

import { errorResponse } from "./respond";

/** Multipart upload through the app server: `file` plus the provenance fields. */
export async function POST(request: Request): Promise<Response> {
  try {
    const user = await requireUser();
    const declaredLength = Number(request.headers.get("content-length") ?? 0);
    // Allow for multipart framing and form fields on top of the file itself.
    if (declaredLength > GEO_CONTRACT.maxFileBytes + 64 * 1024) {
      throw new UploadValidationError({ file: "The file is larger than the import limit." });
    }
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new UploadValidationError({ file: "Choose a file to import." });
    const fields = Object.fromEntries([...form.entries()].filter(([key, value]) => key !== "file" && typeof value === "string"));
    const { jobId } = await createImportFromUpload(
      user,
      { fileName: file.name, bytes: Buffer.from(await file.arrayBuffer()) },
      fields,
    );
    return Response.json({ jobId }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
