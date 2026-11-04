import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const STEPS = [
  {
    title: "Start from a real trail",
    body: "Pick a curated trail or import your own GPX or GeoJSON. Every dataset keeps its source and licence.",
  },
  {
    title: "Set your limits",
    body: "Daily distance, climb, descent and hours on your feet, plus rest days and the beds you have already booked.",
  },
  {
    title: "Get stages that fit",
    body: "The planner finds a feasible sequence of days along the trail itself, or explains exactly which limit makes that impossible.",
  },
  {
    title: "Adjust, then take it with you",
    body: "Move a day's end, split or merge days, lock what you like. Export GPX per day or for the whole trek, and a printable itinerary.",
  },
] as const;

export default function HomePage() {
  return (
    <>
      <section className="border-b">
        <div className="mx-auto grid w-full max-w-6xl gap-12 px-4 py-16 sm:px-6 lg:grid-cols-[1.1fr_1fr] lg:items-center lg:py-24">
          <div className="space-y-6">
            <p className="eyebrow">Multi-day hiking planner</p>
            <h1 className="text-4xl leading-[1.05] font-semibold sm:text-6xl">
              Plan long trails one stage at a time.
            </h1>
            <p className="max-w-xl text-lg text-muted-foreground">
              RouteEditor splits an existing long-distance trail into daily stages that respect your pace, your limits
              and your bookings. Then it lets you shape every day yourself.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <Link href="/trails" className={cn(buttonVariants({ size: "lg" }), "h-10 px-4")}>
                Explore trails
                <ArrowRight data-icon="inline-end" />
              </Link>
              <span className="text-sm text-muted-foreground">Early development: no trails are published yet.</span>
            </div>
          </div>
          <StageIllustration />
        </div>
      </section>

      <section className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6">
        <h2 className="mb-10 text-2xl font-semibold sm:text-3xl">How planning works</h2>
        <ol className="grid gap-x-10 gap-y-10 sm:grid-cols-2">
          {STEPS.map((step, index) => (
            <li key={step.title} className="grid grid-cols-[auto_1fr] gap-4">
              <span className="metric font-heading text-3xl leading-none text-primary">{index + 1}</span>
              <div className="space-y-1.5">
                <h3 className="text-lg font-medium">{step.title}</h3>
                <p className="text-muted-foreground">{step.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="border-t bg-muted/60">
        <div className="mx-auto grid w-full max-w-6xl gap-8 px-4 py-14 sm:px-6 md:grid-cols-3">
          <h2 className="text-2xl font-semibold">Honest about data</h2>
          <p className="text-muted-foreground">
            Suggested huts and campsites are shown as suggestions, with what is and is not verified. A suggestion is
            never presented as availability or a booking.
          </p>
          <p className="text-muted-foreground">
            Missing elevation is reported, not invented. Demo trails are labelled as synthetic, and third-party data is
            used only where its licence allows.
          </p>
        </div>
      </section>
    </>
  );
}

/** Decorative: an invented profile, not real trail data. */
function StageIllustration() {
  const profile =
    "M0 150 L40 120 L70 132 L110 70 L140 88 L170 60 L200 96 L240 118 L270 80 L310 40 L340 74 L380 104 L420 92 L460 130 L500 110";
  const stages = [
    { x: 0, width: 140, color: "var(--stage-1)", label: "Day 1" },
    { x: 140, width: 130, color: "var(--stage-2)", label: "Day 2" },
    { x: 270, width: 110, color: "var(--stage-3)", label: "Day 3" },
    { x: 380, width: 120, color: "var(--stage-4)", label: "Day 4" },
  ];
  return (
    <figure aria-hidden="true" className="rounded-2xl border bg-card p-5 shadow-sm">
      <svg viewBox="0 0 500 200" className="h-auto w-full">
        <defs>
          <clipPath id="profile-area">
            <path d={`${profile} L500 200 L0 200 Z`} />
          </clipPath>
        </defs>
        <g clipPath="url(#profile-area)">
          {stages.map((stage) => (
            <rect key={stage.label} x={stage.x} y={0} width={stage.width} height={200} fill={stage.color} opacity={0.16} />
          ))}
        </g>
        <path d={profile} fill="none" stroke="var(--foreground)" strokeWidth={2} strokeLinejoin="round" />
        {stages.slice(1).map((stage) => (
          <line key={stage.label} x1={stage.x} x2={stage.x} y1={12} y2={196} stroke="var(--border)" strokeDasharray="3 4" />
        ))}
        {stages.map((stage) => (
          <text key={stage.label} x={stage.x + 8} y={20} fontSize={11} fill="var(--muted-foreground)">
            {stage.label}
          </text>
        ))}
      </svg>
      <figcaption className="mt-3 text-xs text-muted-foreground">Illustration only.</figcaption>
    </figure>
  );
}
