import { connection } from "next/server";

import { db } from "@/lib/db/client";
import { postgisVersion } from "@/lib/db/geometry";

/** Liveness and database check. Reports versions only, never configuration values. */
export async function GET() {
  await connection();
  try {
    const postgis = await postgisVersion(db());
    return Response.json({ status: "ok", database: "ok", postgis });
  } catch {
    return Response.json({ status: "degraded", database: "unavailable" }, { status: 503 });
  }
}
