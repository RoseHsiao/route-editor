import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { FileUp, Upload } from "lucide-react";

import { ImportStatusBadge } from "@/components/import/import-status-badge";
import { UploadForm } from "@/components/import/upload-form";
import { EmptyState, PageHeader } from "@/components/layout/page-header";
import { getCurrentUser } from "@/lib/auth/current-user";
import { listImports } from "@/services/trail-data/imports";

export const metadata: Metadata = { title: "Imports" };

export default function ImportsPage() {
  return (
    <div className="space-y-10">
      <PageHeader
        eyebrow="Your data"
        title="Imports"
        description="Upload a GPX or GeoJSON file to see it on the map, with its distance, elevation profile and any data-quality problems."
      />
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading imports…</p>}>
        <ImportsContent />
      </Suspense>
    </div>
  );
}

async function ImportsContent() {
  await connection();
  const user = await getCurrentUser();
  if (!user) {
    return (
      <EmptyState icon={<Upload />} title="Sign-in is not available yet">
        Accounts arrive in Milestone 4. In local development, set AUTH_DEV_STUB=true to use the development user.
      </EmptyState>
    );
  }
  const imports = await listImports(user);
  return (
    <div className="grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <section aria-labelledby="new-import" className="space-y-4">
        <h2 id="new-import" className="text-xl font-medium">
          New import
        </h2>
        <UploadForm />
      </section>
      <section aria-labelledby="previous-imports" className="space-y-4">
        <h2 id="previous-imports" className="text-xl font-medium">
          Previous imports
        </h2>
        {imports.length === 0 ? (
          <EmptyState icon={<FileUp />} title="No imports yet">
            Files you upload appear here. Nothing is shown until you import something.
          </EmptyState>
        ) : (
          <ul className="divide-y rounded-xl border bg-card">
            {imports.map((job) => (
              <li key={job.id}>
                <Link href={`/imports/${job.id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-muted">
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{job.trailName ?? job.fileName ?? "Untitled file"}</span>
                    <span className="metric block text-xs text-muted-foreground">
                      {job.createdAt.toISOString().slice(0, 16).replace("T", " ")} UTC
                    </span>
                  </span>
                  <ImportStatusBadge status={job.status} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
