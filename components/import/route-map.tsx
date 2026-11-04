"use client";

import "maplibre-gl/dist/maplibre-gl.css";

import type { GeoJSONSourceSpecification, Map as MapLibreMap, StyleSpecification } from "maplibre-gl";
import { useEffect, useRef, useState } from "react";

import type { RouteMapData } from "@/lib/import/route-view";

/** MapLibre cannot parse oklch(); resolve design tokens to sRGB through a canvas. */
function tokenColor(token: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(token).trim();
  if (!value) return fallback;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const context = canvas.getContext("2d");
  if (!context) return fallback;
  context.fillStyle = fallback;
  context.fillStyle = value;
  context.fillRect(0, 0, 1, 1);
  const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
  return `rgb(${r}, ${g}, ${b})`;
}

function blankStyle(background: string): StyleSpecification {
  return { version: 8, sources: {}, layers: [{ id: "background", type: "background", paint: { "background-color": background } }] };
}

export function RouteMap({ data, styleUrl }: { data: RouteMapData; styleUrl: string | null }) {
  const container = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let map: MapLibreMap | undefined;
    let cancelled = false;
    (async () => {
      const maplibre = await import("maplibre-gl");
      if (cancelled || !container.current) return;
      const colors = {
        track: tokenColor("--trail", "#2f6b55"),
        route: tokenColor("--trail-alternative", "#7a5c2e"),
        line: tokenColor("--info", "#3a6f9a"),
        caution: tokenColor("--caution", "#c98a1b"),
        danger: tokenColor("--destructive", "#b2452f"),
        waypoint: tokenColor("--foreground", "#2a2f36"),
        background: tokenColor("--muted", "#f1efe9"),
        halo: tokenColor("--card", "#ffffff"),
      };
      map = new maplibre.Map({
        container: container.current,
        style: styleUrl ?? blankStyle(colors.background),
        attributionControl: { compact: true },
        cooperativeGestures: true,
        ...(data.bounds ? { bounds: data.bounds, fitBoundsOptions: { padding: 40 } } : { center: [0, 0], zoom: 1 }),
      });
      map.addControl(new maplibre.NavigationControl({ showCompass: false }), "top-right");
      map.addControl(new maplibre.ScaleControl({ unit: "metric" }), "bottom-left");
      map.on("error", (event) => {
        // Tile or style failures leave the route visible on an empty background.
        if (event.error && String(event.error.message).includes("style")) setFailed(true);
      });
      map.on("load", () => {
        if (!map) return;
        map.addSource("routes", { type: "geojson", data: data.routes as unknown as GeoJSONSourceSpecification["data"] });
        map.addSource("issues", { type: "geojson", data: data.issues as unknown as GeoJSONSourceSpecification["data"] });
        map.addSource("waypoints", { type: "geojson", data: data.waypoints as unknown as GeoJSONSourceSpecification["data"] });
        const kindColor = ["match", ["get", "sourceKind"], "TRACK", colors.track, "ROUTE", colors.route, colors.line];
        map.addLayer({
          id: "routes-casing",
          type: "line",
          source: "routes",
          layout: { "line-cap": "round", "line-join": "round" },
          paint: { "line-color": colors.halo, "line-width": ["case", ["get", "isMain"], 7, 5] },
        });
        map.addLayer({
          id: "routes-solid",
          type: "line",
          source: "routes",
          filter: ["!=", ["get", "sourceKind"], "ROUTE"],
          layout: { "line-cap": "round", "line-join": "round" },
          paint: { "line-color": kindColor as never, "line-width": ["case", ["get", "isMain"], 4, 2.5] },
        });
        // Planned routes are dashed: straight connections between route points.
        map.addLayer({
          id: "routes-planned",
          type: "line",
          source: "routes",
          filter: ["==", ["get", "sourceKind"], "ROUTE"],
          layout: { "line-join": "round" },
          paint: {
            "line-color": colors.route,
            "line-width": ["case", ["get", "isMain"], 4, 2.5],
            "line-dasharray": [2, 1.5],
          },
        });
        map.addLayer({
          id: "issue-connectors",
          type: "line",
          source: "issues",
          filter: ["==", ["geometry-type"], "LineString"],
          paint: {
            "line-color": ["case", ["==", ["get", "severity"], "error"], colors.danger, colors.caution],
            "line-width": 2,
            "line-dasharray": [0.5, 1.5],
          },
        });
        map.addLayer({
          id: "issue-points",
          type: "circle",
          source: "issues",
          filter: ["==", ["geometry-type"], "Point"],
          paint: {
            "circle-radius": 5,
            "circle-color": ["case", ["==", ["get", "severity"], "error"], colors.danger, colors.caution],
            "circle-stroke-color": colors.halo,
            "circle-stroke-width": 2,
          },
        });
        map.addLayer({
          id: "waypoints",
          type: "circle",
          source: "waypoints",
          paint: {
            "circle-radius": 4.5,
            "circle-color": colors.halo,
            "circle-stroke-color": colors.waypoint,
            "circle-stroke-width": 2,
          },
        });
        const popup = new maplibre.Popup({ closeButton: false, closeOnClick: false });
        for (const layer of ["waypoints", "issue-points", "routes-solid", "routes-planned"]) {
          map.on("mousemove", layer, (event) => {
            const feature = event.features?.[0];
            if (!map || !feature) return;
            map.getCanvas().style.cursor = "pointer";
            const p = feature.properties as Record<string, string | undefined>;
            const text = layer === "waypoints" ? (p.name ?? "Unnamed waypoint") : layer === "issue-points" ? p.code : p.name;
            popup.setLngLat(event.lngLat).setText(text ?? "").addTo(map);
          });
          map.on("mouseleave", layer, () => {
            if (!map) return;
            map.getCanvas().style.cursor = "";
            popup.remove();
          });
        }
      });
    })().catch(() => setFailed(true));
    return () => {
      cancelled = true;
      map?.remove();
    };
  }, [data, styleUrl]);

  return (
    <div className="space-y-2">
      <div
        ref={container}
        role="region"
        aria-label="Map of the imported route"
        className="h-[420px] w-full overflow-hidden rounded-xl border bg-muted"
      />
      {styleUrl === null ? (
        <p className="text-xs text-muted-foreground">
          No basemap is configured (NEXT_PUBLIC_MAP_STYLE_URL), so the route is drawn on a blank background.
        </p>
      ) : null}
      {failed ? <p className="text-xs text-destructive">The map could not be loaded. The data below is unaffected.</p> : null}
    </div>
  );
}
