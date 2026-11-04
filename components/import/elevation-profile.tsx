"use client";

import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import type { ProfilePoint } from "@/lib/import/route-view";

/**
 * Smoothed elevation against route km. Breaks between source segments are null points,
 * so the chart leaves a gap there instead of drawing a slope that was never recorded.
 */
export function ElevationProfile({
  points,
  breaksKm,
  label,
}: {
  points: ProfilePoint[];
  breaksKm: number[];
  label: string;
}) {
  const values = points.flatMap((point) => (point.elevationM === null ? [] : [point.elevationM]));
  const min = Math.min(...values);
  const max = Math.max(...values);
  const pad = Math.max(10, (max - min) * 0.1);
  return (
    <figure className="space-y-2">
      <div className="h-56 w-full" role="img" aria-label={`Elevation profile of ${label}, ${Math.round(min)} to ${Math.round(max)} metres`}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="var(--border)" vertical={false} />
            <XAxis
              dataKey="km"
              type="number"
              domain={[0, "dataMax"]}
              tickFormatter={(km: number) => `${km.toFixed(km < 10 ? 1 : 0)}`}
              unit=" km"
              tick={{ fontSize: 12, fill: "var(--muted-foreground)" }}
              stroke="var(--border)"
            />
            <YAxis
              domain={[Math.floor(min - pad), Math.ceil(max + pad)]}
              tickFormatter={(m: number) => `${Math.round(m)}`}
              unit=" m"
              width={64}
              tick={{ fontSize: 12, fill: "var(--muted-foreground)" }}
              stroke="var(--border)"
            />
            <Tooltip
              formatter={(value) => [`${Math.round(Number(value))} m`, "Elevation (smoothed)"]}
              labelFormatter={(km) => `${Number(km).toFixed(2)} km`}
              contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }}
            />
            {breaksKm.map((km) => (
              <ReferenceLine
                key={km}
                x={km}
                stroke="var(--caution)"
                strokeDasharray="4 4"
                label={{ value: "not connected", position: "insideTop", fontSize: 11, fill: "var(--muted-foreground)" }}
              />
            ))}
            <Area
              type="linear"
              dataKey="elevationM"
              stroke="var(--elevation-line)"
              fill="var(--elevation-fill)"
              strokeWidth={2}
              connectNulls={false}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      {breaksKm.length > 0 ? (
        <figcaption className="text-xs text-muted-foreground">
          Dashed lines mark breaks between separate source segments. The elevation change across a break was not
          recorded and is not counted as ascent or descent.
        </figcaption>
      ) : null}
    </figure>
  );
}
