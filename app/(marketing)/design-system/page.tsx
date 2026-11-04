import type { Metadata } from "next";
import { Lock, TriangleAlert } from "lucide-react";

import { ReliabilityBadge } from "@/components/accommodation/reliability-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ACCOMMODATION_RELIABILITY } from "@/lib/accommodation/reliability";

export const metadata: Metadata = { title: "Design system", robots: { index: false } };

const CORE = ["background", "card", "muted", "secondary", "accent", "primary", "info", "caution", "destructive", "border"];
const STAGES = [1, 2, 3, 4, 5, 6, 7, 8];
const POIS = ["accommodation", "water", "food", "rest", "transport", "hazard", "pass"];

export default function DesignSystemPage() {
  return (
    <div className="mx-auto w-full max-w-6xl space-y-16 px-4 py-14 sm:px-6">
      <header className="max-w-2xl space-y-2">
        <p className="eyebrow">Reference</p>
        <h1 className="text-4xl font-semibold">Design system</h1>
        <p className="text-muted-foreground">
          Tokens and components used across TrailPlanner. Values on this page are examples, not trail data.
        </p>
      </header>

      <Section title="Typography">
        <div className="space-y-3">
          <p className="font-heading text-5xl font-semibold tracking-tight">Source Serif 4, display</p>
          <p className="font-heading text-2xl">Headings carry the editorial voice.</p>
          <p className="max-w-prose">
            Inter for interface and body text. Long-form copy stays within a readable measure and uses the muted
            foreground for secondary information.
          </p>
          <p className="metric text-lg">
            18.4 km · ↑ 1 240 m · ↓ 980 m · 6 h 45 min <span className="text-muted-foreground">(tabular figures)</span>
          </p>
          <p className="font-mono text-sm">JetBrains Mono for coordinates: 45.88992, 6.79804</p>
        </div>
      </Section>

      <Section title="Colour">
        <SwatchGrid names={CORE} variable={(name) => `--${name}`} />
      </Section>

      <Section title="Daily stage palette" note="Map segments and chart bands. Adjacent days stay distinguishable.">
        <div className="flex h-3 overflow-hidden rounded-full">
          {STAGES.map((n) => (
            <div key={n} className="flex-1" style={{ background: `var(--stage-${n})` }} />
          ))}
        </div>
        <SwatchGrid names={STAGES.map(String)} variable={(n) => `--stage-${n}`} label={(n) => `Day ${n}`} />
      </Section>

      <Section title="Points of interest">
        <SwatchGrid names={POIS} variable={(name) => `--poi-${name}`} />
      </Section>

      <Section title="Accommodation reliability" note="Text always accompanies colour. See ADR 0006.">
        <div className="flex flex-wrap gap-3">
          {ACCOMMODATION_RELIABILITY.map((value) => (
            <ReliabilityBadge key={value} reliability={value} />
          ))}
          <ReliabilityBadge reliability="UNVERIFIED" recommended />
        </div>
      </Section>

      <Section title="Controls">
        <div className="flex flex-wrap items-center gap-3">
          <Button>Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="destructive">Destructive</Button>
          <Badge>Badge</Badge>
          <Badge variant="outline">Outline</Badge>
        </div>
      </Section>

      <Section title="Day card" note="Example values.">
        <article className="max-w-sm rounded-xl border bg-card p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="size-2.5 rounded-full" style={{ background: "var(--stage-2)" }} />
              <h3 className="font-heading text-lg font-medium">Day 2</h3>
            </div>
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <Lock className="size-3.5" aria-hidden="true" /> Locked
            </span>
          </div>
          <dl className="metric mt-3 grid grid-cols-4 gap-2 text-sm">
            <Metric label="Distance" value="18.4 km" />
            <Metric label="Ascent" value="1 240 m" />
            <Metric label="Descent" value="980 m" />
            <Metric label="Time" value="6:45" />
          </dl>
          <div className="mt-4 flex items-center justify-between gap-2 border-t pt-3">
            <span className="truncate text-sm">Example refuge</span>
            <ReliabilityBadge reliability="VERIFIED_AVAILABILITY_UNKNOWN" recommended />
          </div>
          <p className="mt-3 flex items-center gap-1.5 text-xs text-caution-foreground dark:text-caution">
            <TriangleAlert className="size-3.5" aria-hidden="true" /> No water source for 11 km
          </p>
        </article>
      </Section>
    </div>
  );
}

function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-5">
      <div className="flex items-baseline justify-between gap-4 border-b pb-2">
        <h2 className="text-xl font-semibold">{title}</h2>
        {note ? <p className="text-sm text-muted-foreground">{note}</p> : null}
      </div>
      {children}
    </section>
  );
}

function SwatchGrid({
  names,
  variable,
  label = (name) => name,
}: {
  names: string[];
  variable: (name: string) => string;
  label?: (name: string) => string;
}) {
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-5">
      {names.map((name) => (
        <li key={name} className="overflow-hidden rounded-lg border bg-card">
          <div className="h-14" style={{ background: `var(${variable(name)})` }} />
          <div className="px-3 py-2 text-xs">
            <p className="font-medium">{label(name)}</p>
            <p className="font-mono text-muted-foreground">{variable(name)}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}
