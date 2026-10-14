"use client";

import { useState } from "react";

type BusinessLocationMapProps = {
  businessName: string;
  latitude: number;
  longitude: number;
  mapUrl: string;
};

export function BusinessLocationMap({
  businessName,
  latitude,
  longitude,
  mapUrl,
}: BusinessLocationMapProps) {
  const [mapKey, setMapKey] = useState(0);

  return (
    <div className="business-map-container">
      <div className="business-map-toolbar">
        <button
          className="map-reset-button"
          onClick={() => setMapKey((currentKey) => currentKey + 1)}
          type="button"
        >
          Reset
        </button>
      </div>
      <iframe
        className="business-map"
        key={mapKey}
        loading="lazy"
        referrerPolicy="strict-origin-when-cross-origin"
        src={mapUrl}
        title={`Map showing ${businessName} at ${latitude}, ${longitude}`}
      />
      <a
        className="text-link map-external-link"
        href={`https://www.openstreetmap.org/?mlat=${latitude}&mlon=${longitude}#map=18/${latitude}/${longitude}`}
        rel="noreferrer"
        target="_blank"
      >
        Open in OpenStreetMap
      </a>
    </div>
  );
}
