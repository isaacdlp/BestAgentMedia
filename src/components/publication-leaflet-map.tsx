"use client";

import {
  GeoJSON,
  MapContainer,
  ScaleControl,
  TileLayer,
  useMap,
} from "react-leaflet";
import type { LatLngBoundsExpression } from "leaflet";
import type { PublicationMapData } from "@/lib/zip-code-map";

export default function PublicationLeafletMap({
  mapData,
}: {
  mapData: PublicationMapData;
}) {
  return (
    <MapContainer
      attributionControl
      bounds={mapData.bounds}
      boundsOptions={{ padding: [24, 24], maxZoom: 13 }}
      className="publication-leaflet-map"
      maxZoom={19}
      scrollWheelZoom
      zoomControl
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        maxZoom={19}
        referrerPolicy="strict-origin-when-cross-origin"
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <GeoJSON
        data={mapData}
        onEachFeature={(feature, layer) => {
          const code = feature.properties?.code;
          if (typeof code === "string") {
            layer.bindTooltip(code);
          }
        }}
        style={() => ({
          color: "#1558a8",
          fillColor: "#75a9df",
          fillOpacity: 0.3,
          weight: 2,
        })}
      />
      <ScaleControl position="bottomleft" />
      <ResetMapView
        bounds={mapData.bounds}
        boundsOptions={{ padding: [24, 24], maxZoom: 13 }}
      />
    </MapContainer>
  );
}

function ResetMapView({
  bounds,
  boundsOptions,
}: {
  bounds: LatLngBoundsExpression;
  boundsOptions: { padding: [number, number]; maxZoom: number };
}) {
  const map = useMap();

  return (
    <div className="leaflet-top leaflet-right">
      <div className="leaflet-control leaflet-bar">
        <button
          aria-label="Reset map view"
          className="leaflet-reset-button"
          onClick={() => map.fitBounds(bounds, boundsOptions)}
          title="Reset map view"
          type="button"
        >
          Reset
        </button>
      </div>
    </div>
  );
}
