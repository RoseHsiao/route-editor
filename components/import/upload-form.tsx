"use client";

import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { GEO_CONTRACT } from "@/lib/import/contract";
import { SOURCE_CATEGORY_LABELS, UPLOAD_SOURCE_CATEGORIES } from "@/lib/import/upload";

type FieldErrors = Record<string, string>;

const noopSubscribe = () => () => {};

async function sha256Hex(file: File): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function errorFrom(response: Response): Promise<FieldErrors> {
  const body = (await response.json().catch(() => null)) as {
    error?: { message?: string; fields?: FieldErrors };
  } | null;
  return body?.error?.fields ?? { form: body?.error?.message ?? `The upload failed (HTTP ${response.status}).` };
}

function FieldError({ errors, name }: { errors: FieldErrors; name: string }) {
  return errors[name] ? (
    <p id={`${name}-error`} className="text-sm text-destructive">
      {errors[name]}
    </p>
  ) : null;
}

const selectClass =
  "h-8 w-full rounded-lg border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

export function UploadForm() {
  const router = useRouter();
  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [category, setCategory] = useState<string>("USER_UPLOAD");
  // Until hydration, a click would submit the form natively and silently drop the file.
  const hydrated = useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) {
      setErrors({ file: "Choose a .gpx, .geojson or .json file." });
      return;
    }
    if (file.size > GEO_CONTRACT.maxFileBytes) {
      setErrors({ file: `The file is larger than ${Math.round(GEO_CONTRACT.maxFileBytes / 1024 / 1024)} MB.` });
      return;
    }
    setErrors({});
    try {
      setBusy("Checking the file…");
      const sha256 = await sha256Hex(file);
      const ticketResponse = await fetch("/api/imports/uploads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileName: file.name, sizeBytes: file.size, sha256 }),
      });
      if (!ticketResponse.ok) return setErrors(await errorFrom(ticketResponse));
      const ticket = (await ticketResponse.json()) as
        | { mode: "server" }
        | { mode: "direct"; key: string; url: string; headers: Record<string, string> };

      setBusy("Uploading…");
      let response: Response;
      if (ticket.mode === "direct") {
        const put = await fetch(ticket.url, { method: "PUT", headers: ticket.headers, body: file });
        if (!put.ok) return setErrors({ file: `Storage rejected the upload (HTTP ${put.status}).` });
        const fields = Object.fromEntries([...form.entries()].filter(([key]) => key !== "file"));
        response = await fetch("/api/imports/uploads/complete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...fields, key: ticket.key, fileName: file.name, sizeBytes: file.size, sha256 }),
        });
      } else {
        response = await fetch("/api/imports", { method: "POST", body: form });
      }
      if (!response.ok) return setErrors(await errorFrom(response));
      const { jobId } = (await response.json()) as { jobId: string };
      router.push(`/imports/${jobId}`);
    } catch {
      setErrors({ form: "The upload could not be sent. Check your connection and try again." });
    } finally {
      setBusy(null);
    }
  }

  const describedBy = (name: string) => (errors[name] ? `${name}-error` : undefined);

  return (
    <form onSubmit={submit} noValidate className="space-y-6 rounded-xl border bg-card p-5 sm:p-6">
      <div className="space-y-2">
        <Label htmlFor="file">GPX or GeoJSON file</Label>
        <Input
          id="file"
          name="file"
          type="file"
          accept=".gpx,.geojson,.json,application/gpx+xml,application/geo+json"
          aria-invalid={Boolean(errors.file)}
          aria-describedby={describedBy("file")}
          required
        />
        <p className="text-xs text-muted-foreground">
          Tracks (&lt;trk&gt;), planned routes (&lt;rte&gt;) and waypoints (&lt;wpt&gt;) are kept apart. The original file
          is stored unchanged. Up to {Math.round(GEO_CONTRACT.maxFileBytes / 1024 / 1024)} MB.
        </p>
        <FieldError errors={errors} name="file" />
      </div>

      <div className="space-y-2">
        <Label htmlFor="trailName">Name (optional)</Label>
        <Input id="trailName" name="trailName" maxLength={200} placeholder="Taken from the file if empty" />
      </div>

      <fieldset className="space-y-4">
        <legend className="font-heading text-base font-medium">Where does the data come from?</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {UPLOAD_SOURCE_CATEGORIES.map((value) => (
            <label
              key={value}
              className="flex cursor-pointer flex-col gap-1 rounded-lg border p-3 text-sm has-checked:border-primary has-checked:bg-secondary"
            >
              <span className="flex items-center gap-2 font-medium">
                <input
                  type="radio"
                  name="sourceCategory"
                  value={value}
                  checked={category === value}
                  onChange={() => setCategory(value)}
                />
                {SOURCE_CATEGORY_LABELS[value].label}
              </span>
              <span className="text-xs text-muted-foreground">{SOURCE_CATEGORY_LABELS[value].hint}</span>
            </label>
          ))}
        </div>
        <FieldError errors={errors} name="sourceCategory" />

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="sourceName">Source name</Label>
            <Input
              id="sourceName"
              name="sourceName"
              required
              maxLength={200}
              placeholder={category === "USER_UPLOAD" ? "My GPS watch" : "Website or organisation"}
              aria-invalid={Boolean(errors.sourceName)}
              aria-describedby={describedBy("sourceName")}
            />
            <FieldError errors={errors} name="sourceName" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="sourceUrl">Source URL (optional)</Label>
            <Input
              id="sourceUrl"
              name="sourceUrl"
              type="url"
              maxLength={2000}
              aria-invalid={Boolean(errors.sourceUrl)}
              aria-describedby={describedBy("sourceUrl")}
            />
            <FieldError errors={errors} name="sourceUrl" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="license">Licence (optional)</Label>
            <Input id="license" name="license" maxLength={100} placeholder="e.g. ODbL-1.0. Unknown if empty" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="attributionText">
              Attribution {category === "OPEN_DATA" ? "(required)" : "(optional)"}
            </Label>
            <Input
              id="attributionText"
              name="attributionText"
              maxLength={500}
              placeholder={category === "OPEN_DATA" ? "© OpenStreetMap contributors" : undefined}
              aria-invalid={Boolean(errors.attributionText)}
              aria-describedby={describedBy("attributionText")}
            />
            <FieldError errors={errors} name="attributionText" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="redistributionAllowed">May it be shared with others?</Label>
            <select id="redistributionAllowed" name="redistributionAllowed" defaultValue="unknown" className={selectClass}>
              <option value="unknown">Unknown (treated as no)</option>
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="commercialUseAllowed">May it be used commercially?</Label>
            <select id="commercialUseAllowed" name="commercialUseAllowed" defaultValue="unknown" className={selectClass}>
              <option value="unknown">Unknown (treated as no)</option>
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </select>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Imports are private to you. Declaring a licence does not publish anything.
        </p>
      </fieldset>

      <details className="rounded-lg border p-3 text-sm">
        <summary className="cursor-pointer font-medium">Gap thresholds</summary>
        <p className="mt-2 text-xs text-muted-foreground">
          Applied inside each continuous track segment or line. Separate track segments are never joined, and the
          distance between them never fails an import. Route points are planned straight connections and are exempt.
        </p>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="gapWarnM">Warn above (m)</Label>
            <Input id="gapWarnM" name="gapWarnM" type="number" min={1} placeholder={String(GEO_CONTRACT.defaultGapWarnM)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="gapFailM">Fail above (m)</Label>
            <Input
              id="gapFailM"
              name="gapFailM"
              type="number"
              min={1}
              placeholder={String(GEO_CONTRACT.defaultGapFailM)}
              aria-invalid={Boolean(errors.gapFailM)}
              aria-describedby={describedBy("gapFailM")}
            />
            <FieldError errors={errors} name="gapFailM" />
          </div>
        </div>
      </details>

      <FieldError errors={errors} name="form" />
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={!hydrated || busy !== null}>
          {busy ?? "Import"}
        </Button>
        <p aria-live="polite" className="text-sm text-muted-foreground">
          {busy ? "Do not close this page until the upload finishes." : null}
        </p>
      </div>
    </form>
  );
}
