import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { Upload } from "lucide-react";

import { ImportStatusRefresher, RetryImportButton } from "@/components/import/import-actions";
import { ImportStatusBadge } from "@/components/import/import-status-badge";
import { IssueList, RouteDetails } from "@/components/import/route-details";
import { EmptyState } from "@/components/layout/page-header";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getImport } from "@/services/trail-data/imports";
import { getImportedRoute } from "@/services/trail-data/route-view";

export const metadata: Metadata = { title: "Import" };

export default function ImportPage({ params }: PageProps<"/imports/[id]">) {
  return (
    <div className="space-y-8">
      <Link href="/imports" className="text-sm text-muted-foreground hover:text-foreground">
        ← All imports
      </Link>
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading import…</p>}>
        <ImportContent params={params} />
      </Suspense>
    </div>
  );
}

async function ImportContent({ params }: { params: PageProps<"/imports/[id]">["params"] }) {
  await connection();
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) {
    return (
      <EmptyState icon={<Upload />} title="Sign-in is not available yet">
        Accounts arrive in Milestone 4.
      </EmptyState>
    );
  }
  const job = await getImport(user, id);
  if (!job) notFound();
  const route = job.status === "SUCCEEDED" && job.datasetId ? await getImportedRoute(user, job.datasetId) : null;
  const inProgress = job.status === "PENDING" || job.status === "PROCESSING";

  return (
    <div className="space-y-8">
      <header className="space-y-3 border-b pb-6">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-semibold">{route?.trailName ?? job.fileName ?? "Import"}</h1>
          <ImportStatusBadge status={job.status} />
        </div>
        <p className="metric text-xs break-all text-muted-foreground">
          {job.fileName} · {(job.sizeBytes / 1024).toFixed(1)} KB · SHA-256 {job.sha256}
        </p>
      </header>

      {job.contractMismatch ? (
        <p role="alert" className="rounded-xl border border-destructive/40 p-4 text-sm text-destructive">
          The worker wrote results in a format this version of the app does not understand. Nothing is shown rather
          than showing it incorrectly.
        </p>
      ) : null}

      {inProgress ? (
        <div className="rounded-xl border bg-card p-5 text-sm" aria-live="polite">
          <ImportStatusRefresher />
          <p className="font-medium">{job.status === "PENDING" ? "Waiting for the geo worker…" : "Processing the file…"}</p>
          <p className="mt-1 text-muted-foreground">
            This page updates by itself. If it stays waiting, check that the worker is running
            (<code className="font-mono">python -m trailworker</code>).
          </p>
        </div>
      ) : null}

      {job.status === "FAILED" ? (
        <div className="space-y-4">
          <section role="alert" className="space-y-2 rounded-xl border border-destructive/40 p-5">
            <h2 className="text-lg font-medium text-destructive">The import failed</h2>
            <p className="text-sm text-muted-foreground">
              Nothing from this file was saved as a route. The original file is kept so the import can be retried.
            </p>
            <ul className="list-disc space-y-1 pl-5 text-sm">
              {job.errors.map((error, index) => (
                <li key={index}>
                  {error.message} <span className="metric text-xs text-muted-foreground">({error.code})</span>
                </li>
              ))}
            </ul>
          </section>
          {job.retryable ? (
            <RetryImportButton jobId={job.id} />
          ) : (
            <p className="text-sm text-muted-foreground">
              Trying again with the same file would fail the same way. Fix the file, then{" "}
              <Link href="/imports" className="underline underline-offset-2">
                upload it again
              </Link>
              .
            </p>
          )}
          {job.report ? <IssueList issues={job.report.issues} title="Everything the worker found" /> : null}
        </div>
      ) : null}

      {job.status === "SUCCEEDED" && !route ? (
        <p className="rounded-xl border border-dashed p-5 text-sm text-muted-foreground">
          This import succeeded, but its data is no longer available.
        </p>
      ) : null}

      {route ? <RouteDetails route={route} /> : null}
    </div>
  );
}
