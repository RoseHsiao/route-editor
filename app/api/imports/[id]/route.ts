import { requireUser } from "@/lib/auth/current-user";
import { getImport, ImportNotFoundError } from "@/services/trail-data/imports";

import { errorResponse } from "../respond";

/** Import status, for polling while the worker runs. */
export async function GET(_request: Request, ctx: RouteContext<"/api/imports/[id]">): Promise<Response> {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    const job = await getImport(user, id);
    if (!job) throw new ImportNotFoundError();
    return Response.json({
      id: job.id,
      status: job.status,
      datasetId: job.datasetId,
      errors: job.errors,
      retryable: job.retryable,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
