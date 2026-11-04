"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";

/** Re-renders the page while the worker is still processing the job. */
export function ImportStatusRefresher({ intervalMs = 2000 }: { intervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const timer = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(timer);
  }, [router, intervalMs]);
  return null;
}

export function RetryImportButton({ jobId }: { jobId: string }) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "busy" | string>("idle");
  async function retry() {
    setState("busy");
    const response = await fetch(`/api/imports/${jobId}/retry`, { method: "POST" }).catch(() => null);
    if (response?.ok) {
      setState("idle");
      router.refresh();
      return;
    }
    const body = (await response?.json().catch(() => null)) as { error?: { message?: string } } | null;
    setState(body?.error?.message ?? "The retry could not be started.");
  }
  return (
    <div className="flex items-center gap-3">
      <Button onClick={retry} disabled={state === "busy"}>
        {state === "busy" ? "Retrying…" : "Retry import"}
      </Button>
      {state !== "idle" && state !== "busy" ? <p className="text-sm text-destructive">{state}</p> : null}
    </div>
  );
}
