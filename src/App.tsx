// Deskthing
import React, { useEffect, useRef } from "react";
import { DeskThing } from "@deskthing/client";
import 'leaflet/dist/leaflet.css';
import MapComponentHandle, { type MapComponentHandle as MapComponentHandleType } from './mapComponent';
const safeSecurityTypes = ["-", "N/A"] as const;

const isDev = process.env.NODE_ENV === 'development';
// =================== Main ScreenViewer Component ===================
const ScreenViewer: React.FC = () => {

  const mapRef = useRef<MapComponentHandleType>(null);

  const handleAddPoint = (lat: number, lng: number, ip: string, security: string) => {

    const safe = safeSecurityTypes.includes(security as any);

    mapRef.current?.addPoint(lat, lng, ip, safe ? 'orange' : 'red', 
        safe ? 1000 : 0);
  };

  useEffect(() => {
    const handler = (msg: any) => {
      isDev && console.log(msg.payload.lat + ", " + msg.payload.lon + " - " + msg.payload.ip + " - " + msg.payload.security);
      try {
        if (msg.payload.lat !== 0 || msg.payload.lon !== 0) { // Sometimes the geolocation API returns (0,0) for private IPs or when it fails to find a location. Ignore these.
          handleAddPoint(msg.payload.lat, msg.payload.lon, msg.payload.ip, msg.payload.security);
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

