// Deskthing
import React, { useEffect, useRef, useState } from "react";
import { DeskThing } from "@deskthing/client";
import 'leaflet/dist/leaflet.css';
import MapComponentHandle, { type MapComponentHandle as MapComponentHandleType } from './mapComponent';
const safeSecurityTypes = ["-", "N/A"] as const;

const isDev = process.env.NODE_ENV === 'development';


// =================== Main ScreenViewer Component ===================
const ScreenViewer: React.FC = () => {

  const [serverStatus, setServerStatus] = useState("stopped"); // 'loading', 'running', 'stopped'



  useEffect(() => {
    // Focus and blur event handlers to notify the server of the current focus state
    const handleFocus = () => {
      // Notify the server that the view has been focused
      DeskThing.fatal("viewFocused ");
      DeskThing.send({
        type: "focusUpdate",
        payload: "1",
      });
    };

    // Notify the server that the view has been unfocused/blurred
    const handleBlur = () => {
      DeskThing.fatal("viewBlurred ");
      DeskThing.send({
        type: "focusUpdate",
        payload: "0",
      });
    };

    // Add event listeners
    window.addEventListener('focus', handleFocus);
    window.addEventListener('blur', handleBlur);

    // Clean up event listeners on component unmount
    return () => {
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('blur', handleBlur);
    };
  }, []);



  const mapRef = useRef<MapComponentHandleType>(null); // Ref to access MapComponent's API methods

  /**
   * Handles the addition of a new point to the map based on the provided latitude, longitude, IP address, and security status.
   * 
   * @param lat - Latitude in degrees (-90 to 90)
   * @param lng - Longitude in degrees (-180 to 180)
   * @param ip - The IP address associated with the location update
   * @param security - The security status of the IP (e.g., "safe", "unsafe", "N/A")
   * @returns void
   **/
  const handleAddPoint = (lat: number, lng: number, ip: string, security: string) => {
    const safe = safeSecurityTypes.includes(security as any);
    mapRef.current?.addPoint(lat, lng, ip, safe ? 'orange' : 'red',
      safe ? 1000 : 0);
  };

  // Handles incoming data from server and updates the map accordingly
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

  // Handles incoming server status updates and updates the local state accordingly
  useEffect(() => {
    const handler = (msg: any) => {
      if (msg.payload) {
        setServerStatus(msg.payload);
      }
    }
    return DeskThing.on("serverStatus", handler);
  }, []);


  // Main view rendering
  return (
    <div className="w-screen h-screen  cursor-none pointer-events-none">
      {(serverStatus === "loading" || serverStatus === "stopped") && (
        <div className="absolute top-0 left-0 right-0 bottom-0 flex flex-row justify-center items-center h-1/8 w-1/8 z-10 backdrop-blur-lg bg-black/70">
          <div className="absolute top-0 left-0 right-0 bottom-0 flex flex-row justify-center items-center h-1/8 w-1/8 z-10">| Tap on screen to start |</div>
          <div className="absolute top-10 left-0 right-0 bottom-0 flex flex-row justify-center items-center h-1/8 w-1/8 z-10">| serverStatus: {serverStatus} |</div>
          
        </div>
      )}
      <MapComponentHandle ref={mapRef} />
    </div>
  );
};
export default ScreenViewer;

