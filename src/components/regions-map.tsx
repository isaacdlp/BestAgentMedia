"use client";

import dynamic from "next/dynamic";

export type RegionPublication = {
  id: number;
  name: string;
};

export type RegionSelection = {
  feature: {
    type: "Feature";
    properties: { code: string };
    geometry: {
      type: "Polygon" | "MultiPolygon";
      coordinates: number[][][] | number[][][][];
    };
  };
  publications: RegionPublication[];
};

const InteractiveRegionsMap = dynamic(
  () => import("@/components/interactive-regions-map"),
  {
    ssr: false,
    loading: () => (
      <div className="regions-map regions-map-loading">Loading map…</div>
    ),
  },
);

export function RegionsMap({
  onSelect,
  onError,
  onLoadingChange,
  selection,
  selectionMaxZoom = 12,
}: {
  onSelect: (selection: RegionSelection | null) => void;
  onError: (message: string | null) => void;
  onLoadingChange: (loading: boolean) => void;
  selection: RegionSelection | null;
  selectionMaxZoom?: number;
}) {
  return (
    <InteractiveRegionsMap
      onError={onError}
      onLoadingChange={onLoadingChange}
      onSelect={onSelect}
      selection={selection}
      selectionMaxZoom={selectionMaxZoom}
    />
  );
}
