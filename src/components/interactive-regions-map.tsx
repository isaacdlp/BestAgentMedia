"use client";

import { useCallback, useEffect, useRef } from "react";
import {
  GeoJSON,
  MapContainer,
  ScaleControl,
  TileLayer,
  useMap,
  useMapEvents,
} from "react-leaflet";
import { latLngBounds } from "leaflet";
import type { LeafletMouseEvent } from "leaflet";
import type { RegionSelection } from "@/components/regions-map";

const usaCenter: [number, number] = [39.5, -98.35];

export default function InteractiveRegionsMap({
  onSelect,
  onError,
  onLoadingChange,
  selection,
  selectionMaxZoom,
}: {
  onSelect: (selection: RegionSelection | null) => void;
  onError: (message: string | null) => void;
  onLoadingChange: (loading: boolean) => void;
  selection: RegionSelection | null;
  selectionMaxZoom: number;
}) {
  const clickRequestId = useRef(0);
  const handleMapClick = useCallback(
    async ({ latlng }: LeafletMouseEvent) => {
      const requestId = ++clickRequestId.current;
      onSelect(null);
      onError(null);
      onLoadingChange(true);
      try {
        const response = await fetch(
          `/api/regions/zip-code?lat=${encodeURIComponent(latlng.lat)}&lng=${encodeURIComponent(latlng.lng)}`,
        );
        if (requestId !== clickRequestId.current) {
          return;
        }
        const result = (await response.json()) as
          | RegionSelection
          | { error: string };
        if (requestId !== clickRequestId.current) {
          return;
        }
        if (!response.ok) {
          onError(
            "error" in result
              ? result.error
              : "Unable to find a ZIP code at this location.",
          );
          return;
        }
        if (!("feature" in result) || !isValidZipCode(result.feature.properties.code)) {
          throw new Error("The ZIP code lookup returned invalid map data.");
        }
        onSelect(result);
      } catch (error) {
        if (requestId !== clickRequestId.current) {
          return;
        }
        console.error("Region ZIP code lookup failed:", error);
        onError("The ZIP code lookup failed. Please try again.");
      } finally {
        if (requestId === clickRequestId.current) {
          onLoadingChange(false);
        }
      }
    },
    [onError, onLoadingChange, onSelect],
  );

  return (
    <MapContainer
      center={usaCenter}
      className="regions-map"
      maxZoom={18}
      minZoom={3}
      scrollWheelZoom
      zoom={4}
      zoomControl
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        maxZoom={19}
        referrerPolicy="strict-origin-when-cross-origin"
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <MapClickHandler onClick={handleMapClick} />
      {selection ? (
        <>
          <GeoJSON
            data={selection.feature}
            key={selection.feature.properties.code}
            style={() => ({
              color: "#1558a8",
              fillColor: "#75a9df",
              fillOpacity: 0.38,
              weight: 3,
            })}
          />
          <ZoomToSelection
            feature={selection.feature}
            maxZoom={selectionMaxZoom}
          />
        </>
      ) : null}
      <ScaleControl position="bottomleft" />
    </MapContainer>
  );
}

function isValidZipCode(value: unknown): value is string {
  return typeof value === "string" && /^\d{5}$/.test(value);
}

function MapClickHandler({
  onClick,
}: {
  onClick: (event: LeafletMouseEvent) => void;
}) {
  useMapEvents({
    click: onClick,
  });
  return null;
}

function ZoomToSelection({
  feature,
  maxZoom,
}: {
  feature: RegionSelection["feature"];
  maxZoom: number;
}) {
  const map = useMap();
  useEffect(() => {
    const polygons =
      feature.geometry.type === "Polygon"
        ? [feature.geometry.coordinates as RegionPolygon]
        : (feature.geometry.coordinates as RegionPolygon[]);
    const points = polygons.flatMap((polygon) =>
      polygon.flatMap((ring) =>
        ring.map(([longitude, latitude]) => [latitude, longitude] as [number, number]),
      ),
    );
    if (points.length) {
      map.fitBounds(latLngBounds(points), { padding: [35, 35], maxZoom });
    }
  }, [feature, map, maxZoom]);
  return null;
}

type RegionPolygon = [number, number][][];
