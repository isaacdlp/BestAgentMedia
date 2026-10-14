"use client";

import dynamic from "next/dynamic";
import type { PublicationMapData } from "@/lib/zip-code-map";

type PublicationCoverageMapProps = {
  mapData: PublicationMapData;
};

const PublicationLeafletMap = dynamic(
  () => import("@/components/publication-leaflet-map"),
  {
    ssr: false,
    loading: () => (
      <div className="publication-leaflet-map publication-leaflet-map-loading">
        Loading map…
      </div>
    ),
  },
);

export function PublicationCoverageMap({
  mapData,
}: PublicationCoverageMapProps) {
  return <PublicationLeafletMap mapData={mapData} />;
}
