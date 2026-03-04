// Deskthing
import React, { useEffect, useRef, useState } from "react";
import { DeskThing } from "@deskthing/client";
// import 'leaflet/dist/leaflet.css';
import MapComponentHandle, { type MapComponentHandle as MapComponentHandleType } from './mapComponent';

const isDev = process.env.NODE_ENV === 'development';


// =================== Main ScreenViewer Component ===================
const ScreenViewer: React.FC = () => {

  const [serverStatus, setServerStatus] = useState("stopped"); // 'loading', 'running', 'stopped'

  const [locLookupTime, setLocLookupTime] = useState(0);
  const [locUniqueIps, setLocUniqueIps] = useState(0);



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
  const handleAddPoint = (lat: number, lng: number, ip: string, dir: string) => {

    mapRef.current?.addPoint(lat, lng, ip, dir == "in" ? 'cyan' : "orange" ,1000);
  };

  // Handles incoming data from server and updates the map accordingly
  useEffect(() => {
    const handler = (msg: any) => {
      isDev && console.log(msg.payload);
      try {
        if (msg.payload.lat !== 0 || msg.payload.lon !== 0) { // Sometimes the geolocation API returns (0,0) for private IPs or when it fails to find a location. Ignore these.
          setLocLookupTime(parseFloat(msg.payload.locLookupTime));
 
          setLocUniqueIps(parseFloat(msg.payload.locUniqueIps))
       
          handleAddPoint(msg.payload.lat, msg.payload.lon, msg.payload.ip,msg.payload.direction);
          if (msg.payload.trace) {
           
            mapRef.current?.addTraceRoute(
              msg.payload.lat,
              msg.payload.lon,
              msg.payload.ip,
              msg.payload.direction == "in" ? 'cyan' : "orange",
              1000,
              msg.payload.trace
            )
          }
        }

      }
      catch (e) { console.error("Failed to parse mutedApps payload", e); }
    };
    return DeskThing.on("ipLocationUpdate", handler);
  }, []);

/**
 * Subscribes to server status updates from the DeskThing server and updates local state.
 * Cleans up the listener on component unmount via the returned unsubscribe function.
 *
 * @listens serverStatus
 * @param msg.payload - The new server status string ('loading' | 'running' | 'stopped' | 'ERROR')
 */
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
      {(serverStatus === "loading" || serverStatus === "stopped" || serverStatus === "ERROR") && (
        <div className="absolute top-0 left-0 right-0 bottom-0 flex flex-row justify-center items-center h-1/8 w-1/8 z-10 backdrop-blur-lg bg-black/70">
          <div className="absolute top-0 left-0 right-0 bottom-0 flex flex-row justify-center items-center h-1/8 w-1/8 z-10">| Tap on screen to start |</div>
          <div className="absolute top-10 left-0 right-0 bottom-0 flex flex-row justify-center items-center h-1/8 w-1/8 z-10">| serverStatus: {serverStatus} |</div>

        </div>
      )}
      <div className="absolute bottom-5 left-5 h-auto w-auto bg-black/70 z-10 text-md text-white">
        <div className=" p-2">| Location TTS: {locLookupTime.toFixed(3)}s | Unique IP's: {locUniqueIps}</div>

      </div>
      <MapComponentHandle ref={mapRef} />
    </div>
  );
};
export default ScreenViewer;

