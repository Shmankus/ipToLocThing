// Deskthing
import React, { useEffect, useRef, useState } from "react";
import { DeskThing } from "@deskthing/client";
// import 'leaflet/dist/leaflet.css';
import MapComponentHandle, { type MapComponentHandle as MapComponentHandleType } from './mapComponent';

const isDev = process.env.NODE_ENV === 'development';
//'#' + (0x1000000 + Math.random() * 0xffffff).toString(16).substr(1, 6)
let inColor = "rgba(0, 255, 255, .7)"
let outColor = "rgba(255, 0, 0, 0.7)"

// =================== Main ScreenViewer Component ===================
const ScreenViewer: React.FC = () => {

    const [serverStatus, setServerStatus] = useState("stopped"); // 'loading', 'running', 'stopped'
    const [locLookupTime, setLocLookupTime] = useState(0);
    const [locUniqueIps, setLocUniqueIps] = useState(0);
    const [tracedIps, setTracedIps] = useState(0);
    const [totalPackets, setTotalPackets] = useState(0);

    const mapRef = useRef<MapComponentHandleType>(null); // Ref to access MapComponent's API methods

    /**
* Creates listener for view changes 
* @emits focusUpdate
* @param payload - string of either 1 or 0 based on the view focus
*/
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


    /**
 * Subscribes to server updates and adds according routes and points, also updates any usestates
 *
 * @listens ipLocationUpdate
 * @param msg.payload - JSON of all data coming from the server 
 * {"lat": number, "lon": number, "ip": string, "locLookupTime": [], ping: number, trace: [], direction: 'in' 'out', tracedIps: number} 
 */
    useEffect(() => {
        const handler = (msg: any) => {
            isDev && console.log(msg.payload);
            try {
                if (msg.payload) { // Sometimes the geolocation API returns (0,0) for private IPs or when it fails to find a location. Ignore these.
                    setLocLookupTime(parseFloat(msg.payload.locLookupTime));

                    setLocUniqueIps(parseFloat(msg.payload.locUniqueIps))
                    setTracedIps(msg.payload.tracedIps)
                    setTotalPackets(msg.payload.totalPackets)

                    // If trace data is available then add a trace route, otherwise just add the single point for the packet
                    if (msg.payload.trace && msg.payload.trace.length > 1) {

                        mapRef.current?.addTraceRoute(
                            msg.payload.lat,
                            msg.payload.lon,
                            msg.payload.ip,
                            msg.payload.direction == "in" ? inColor : outColor,
                            1000,
                            msg.payload.trace
                        )
                    } else {
                        mapRef.current?.addPoint(msg.payload.lat, msg.payload.lon, msg.payload.ip, msg.payload.direction == "in" ? inColor : outColor, 1000);
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
            {(!isDev && (serverStatus === "loading" || serverStatus === "stopped" || serverStatus === "ERROR")) && (
                <div className="absolute top-0 left-0 right-0 bottom-0 flex flex-row justify-center items-center h-1/8 w-1/8 z-10 backdrop-blur-lg bg-black/70">
                    <div className="absolute top-0 left-0 right-0 bottom-0 flex flex-row justify-center items-center h-1/8 w-1/8 z-10">| Tap on screen to start |</div>
                    <div className="absolute top-10 left-0 right-0 bottom-0 flex flex-row justify-center items-center h-1/8 w-1/8 z-10">| serverStatus: {serverStatus} |</div>

                </div>
            )}
            <div className="absolute bottom-5 left-5 h-auto w-auto bg-black/70 z-10 text-md text-white">
                <div className=" p-2">| Location TTS: {locLookupTime.toFixed(3)}s | Unique IP's: {locUniqueIps}</div>
                <div className=" p-2">| Traced Ips: {tracedIps}</div>
                <div className=" p-2">| Total Packets: {totalPackets}</div>

            </div>
            <div className="absolute bottom-5 right-5 h-auto w-auto bg-black/70 z-10 text-md text-white flex flex-row">
                <div>| Incoming: </div> <div className=" " style={{ color: `${inColor}` }}>⬤</div>
                <div>| Outgoing: </div> <div className=" " style={{ color: `${outColor}` }}>⬤</div> <div>|</div>

            </div>
            <MapComponentHandle ref={mapRef} />
        </div>
    );
};
export default ScreenViewer;

