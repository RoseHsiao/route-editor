import { requireUser } from "@/lib/auth/current-user";
import { retryImport } from "@/services/trail-data/imports";

import { errorResponse } from "../../respond";

export async function POST(_request: Request, ctx: RouteContext<"/api/imports/[id]/retry">): Promise<Response> {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    await retryImport(user, id);
    return Response.json({ status: "PENDING" });
  } catch (error) {
    return errorResponse(error);
  }
}
