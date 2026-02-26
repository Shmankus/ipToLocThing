// Deskthing
import React, { useEffect, useRef, useState } from "react";
import { DeskThing } from "@deskthing/client";
import { DEVICE_CLIENT, SongData11 } from "@deskthing/types";
import 'leaflet/dist/leaflet.css';
import MapComponentHandle, { type MapComponentHandle as MapComponentHandleType } from './mapComponent';


const isDev = process.env.NODE_ENV === 'development';
// =================== Main ScreenViewer Component ===================
const ScreenViewer: React.FC = () => {

  const mapRef = useRef<MapComponentHandleType>(null);

  const handleAddPoint = (lat: number, lng: number, ip: string) => {

    mapRef.current?.addPoint(lat, lng, 'orange', 5);
    mapRef.current?.addText(lat, lng, `${ip}`);
  };

  useEffect(() => {

    const handler = (msg: any) => {
      console.log(msg.payload.lat + ", " + msg.payload.lon + " - " + msg.payload.ip);
      try {
        if (msg.payload.lat !== 0 || msg.payload.lon !== 0) { // Sometimes the geolocation API returns (0,0) for private IPs or when it fails to find a location. Ignore these.
          handleAddPoint(msg.payload.lat, msg.payload.lon, msg.payload.ip);
        }

      }
      catch (e) { console.error("Failed to parse mutedApps payload", e); }
    };
    return DeskThing.on("ipLocationUpdate", handler);
  }, []);

  return (
    <>

      <MapComponentHandle ref={mapRef} />
    </>
  );
};
export default ScreenViewer;

