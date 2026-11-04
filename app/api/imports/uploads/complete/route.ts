import { requireUser } from "@/lib/auth/current-user";
import { completeDirectUpload } from "@/services/trail-data/imports";

import { errorResponse, readJson } from "../../respond";

/** Step 2 of a direct upload: verifies the stored object and creates the import job. */
export async function POST(request: Request): Promise<Response> {
  try {
    const user = await requireUser();
    const { key, fileName, sizeBytes, sha256, ...fields } = await readJson(request);
    const { jobId } = await completeDirectUpload(
      user,
      { key: String(key ?? ""), fileName: String(fileName ?? ""), sizeBytes: Number(sizeBytes ?? 0), sha256: String(sha256 ?? "") },
      fields,
    );
    return Response.json({ jobId }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
