import "./polyfills.mjs"; ///// must be first //////
////////////////////////////////////////////////////
import { DeskThing } from "@deskthing/server";
import { DESKTHING_EVENTS, SETTING_TYPES } from "@deskthing/types";
import path from "path";
import { spawn } from "child_process";
import readline from "readline";
import os from "os";
////////////////////////////////////////////////////
let pythonProcess = null as any;
const isDev = process.env.NODE_ENV === 'development';
const OS = os.platform(); // 'win32', 'darwin', 'linux', etc.
let serverStatus = "stopped"; // 'loading', 'running', 'stopped' | might be used later
let pythonVenvPath = '';
// Decides the .venv path based on the OS and whether we're in development or production. In development, the .venv is located in public/shortcuts (since client code isn't bundled and can access sibling folders),
//  while in production it's located in client/shortcuts (since client is bundled with shortcuts inside it).
switch (OS) {
    case 'win32':
        pythonVenvPath = isDev ? path.join(__dirname, '../public/shortcuts/.venv/Scripts/python.exe') : path.join(__dirname, '../client/shortcuts/.venv/Scripts/python.exe') || "ERROR"
        break;
    case 'darwin':
        pythonVenvPath = isDev ? path.join(__dirname, '../public/shortcuts/.venv/bin/python') : path.join(__dirname, '../client/shortcuts/.venv/bin/python') || "ERROR"
        break;
    case 'linux':
        DeskThing.sendFatal("Python support is currently only implemented for Windows and MacOS.");
        break;
}
// !isDev && dotenv.config({ path: __dirname + '/../client/shortcuts/.env' }); // In production, the client folder is bundled inside the server, so we need to look for the .env file there
// isDev && dotenv.config({ path: __dirname + '/../public/shortcuts/.env' }); // in dev the public folder is visible


/**
 * Starts the python process and reads all lines from the stdout
 * sends "running" server status to client when ready status is printed
 * sends parsed payload to client
 * 
 * @remarks
 * Dev: location to file includes public folder then /shortcuts/file
 * Build: files in public is moved to client then /shortcuts/file
 */
const startPythonProcess = () => {
    DeskThing.send({
        type: "serverStatus",
        payload: "loading", // Send the current focus state to the server
    });
    pythonProcess = spawn(pythonVenvPath, [
        isDev ? path.join(__dirname, '../public/shortcuts/ipToLocation.py') : path.join(__dirname, '../client/shortcuts/ipToLocation.py') || "ERROR" // path to the script
    ], {
        // idk if this is needed aswell
        env: {
            ...process.env,
            ProgramFiles: process.env.ProgramFiles || 'C:\\Program Files',
            'ProgramFiles(x86)': process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)',
            ProgramW6432: process.env.ProgramW6432 || 'C:\\Program Files',
        }
    });

    const rl = readline.createInterface({ input: pythonProcess.stdout });

    rl.on("line", (line) => {
        const trimmed = line.trim();
        if (!trimmed) return;
        try {
            const parsed = JSON.parse(trimmed);

            // ignore the ready message
            if (parsed.status === "ready") {
                DeskThing.send({ type: "serverStatus", payload: "running" });
                DeskThing.send({ type: "localIP", payload: { ip: parsed.localIP , lat: parsed.lat, lon: parsed.lon } });
                return;
            }
            parsed.locUniqueIps = parsed.locLookupTime?.[1] || 0;

            DeskThing.send({
                type: "ipLocationUpdate",
                payload: parsed,
            });
        } catch (error) {
            console.error('Error parsing Python output:', error, 'Raw line:', trimmed);
        }
    });
};

/**
 * Stops the python process if it is alive and then sends a "stopped" server status
 */
const stopPythonProcesses = () => {
    if (!isDev) {
        if (pythonProcess && !pythonProcess.killed) pythonProcess.kill();
        DeskThing.send({
            type: "serverStatus",
            payload: "stopped", // Send the current focus state to the server
        });
    }
};

/**
 * Listens for focus state changes from the client view.
 * Starts the Python processes when the view is focused and stops them when blurred.
 * 
 * @listens focusUpdate
 * @param data.payload - "1" if the view is focused, "0" if blurred
 * 
 * @remarks
 * Only starts Python if both processes are not already running.
 * Stopping is unconditional — any non-"1" payload will kill both processes.
 */
DeskThing.on("focusUpdate", (data: any) => {
    if (data.payload) {
        if (data.payload == "1" && (!pythonProcess || pythonProcess.killed)) {
            startPythonProcess();
        } else {
            stopPythonProcesses();
        }
    }
});


/**
 * Starts when DeskThing server starts
 * 
 * @remarks
 * In dev, this starts the python service automatically
 */
export const start = async () => {
    isDev && startPythonProcess();
};

/**
 * Gets called when the DeskThing server exits
 * 
 * @remarks
 * In dev, this starts the python service automatically
 */
const stop = async () => {
    if (pythonProcess) pythonProcess.kill();
};

DeskThing.on(DESKTHING_EVENTS.START, start);
DeskThing.on(DESKTHING_EVENTS.STOP, stop);
