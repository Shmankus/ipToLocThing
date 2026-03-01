import "./polyfills.mjs"; // must be first
////////////////////////////////////////////////////
import { DeskThing } from "@deskthing/server";
import { DESKTHING_EVENTS, SETTING_TYPES } from "@deskthing/types";
import path from "path";
import { spawn } from "child_process";
import dotenv from "dotenv";
import readline from "readline";
import os from "os";
const isDev = process.env.NODE_ENV === 'development';
// !isDev && dotenv.config({ path: __dirname + '/../client/shortcuts/.env' }); // In production, the client folder is bundled inside the server, so we need to look for the .env file there
// isDev && dotenv.config({ path: __dirname + '/../public/shortcuts/.env' }); // in dev the public folder is visible

const OS = os.platform(); // 'win32', 'darwin', 'linux', etc.


// Decides the .venv path based on the OS and whether we're in development or production. In development, the .venv is located in public/shortcuts (since client code isn't bundled and can access sibling folders), while in production it's located in client/shortcuts (since client is bundled with shortcuts inside it).
let pythonVenvPath = '';
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


// ['-', 'BOTNET', 'SPAM/BOTNET', 'SPAM', 'SPAM/SCANNER/BOTNET', 'SCANNER', 'SCANNER/BOTNET', 'SPAM/SCANNER', 'BOGON', 'BOTNET/BOGON', 'SPAM/SCANNER/BOGON', 'SCANNER/BOGON']
let pythonIpInfo = null as any;
let pythonProcess = null as any;


// !===================== End DeskThing Event Handlers ===================!

export const start = async () => {

    // ======================================================= IP INFO GATHER SECTION =======================================================


    DeskThing.sendFatal("Starting Python process for IP info");



    // change to .venv path and move .venv to shortcuts
    pythonIpInfo = spawn(pythonVenvPath, [
        // path to the script - in dev look in public/shortcuts, in prod look in client/shortcuts (since client is bundled with shortcuts (anything inside public) in prod)
        isDev ? path.join(__dirname, '../public/shortcuts/ipToInfo.py') : path.join(__dirname, '../client/shortcuts/ipToInfo.py') || "ERROR" // path to the script
    ], {
        env: {
            ...process.env,
            ProgramFiles: process.env.ProgramFiles || 'C:\\Program Files',
            'ProgramFiles(x86)': process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)',
            ProgramW6432: process.env.ProgramW6432 || 'C:\\Program Files',
        }
    });

    // Create a readline interface to read lines from the Python process's stdout
    const rlInfoPython = readline.createInterface({ input: pythonIpInfo.stdout });
    // Queue to hold pending promises waiting for Python responses
    const queueInfoPython: { resolve: Function, reject: Function }[] = [];

    // Promise that resolves when the Python script signals it's ready to receive commands
    let pythonReady: () => void;
    const pythonReadyPromise = new Promise<void>(resolve => { pythonReady = resolve; });

    // ONLY ONE line handler
    rlInfoPython.on("line", (line) => {
        //DeskThing.sendFatal(`Raw Python line: ${line}`);
        const data = JSON.parse(line);

        if (data.status === "ready") {
            pythonReady();
            return;
        }

        if (data.debug_ip_int || data.debug_idx !== undefined) return; // ignore debug lines

        if (queueInfoPython.length > 0) {
            const { resolve } = queueInfoPython.shift()!;
            resolve(data);
        }
    });

    pythonIpInfo.stderr.on("data", (d: any) => DeskThing.sendFatal(`Python stderr: ${d.toString()}`));
    pythonIpInfo.on("exit", (code: any) => DeskThing.sendFatal(`Python exited with code: ${code}`));

    function callPython(fn: string, args = {}) {
        return pythonReadyPromise.then(() => new Promise((resolve, reject) => {
            queueInfoPython.push({ resolve, reject });
            pythonIpInfo.stdin.write(JSON.stringify({ fn, args }) + "\n");
        }));
    }



    // ======================================================= IP TO LOCATION SECTION =======================================================


    // Spawn a separate Python process for IP to location (could be combined with the above, but keeping separate for clarity and in case we want to run them on different schedules in the future)
    let pythonProcess = spawn(pythonVenvPath, [
        isDev ? path.join(__dirname, '../public/shortcuts/ipToLocation.py') : path.join(__dirname, '../client/shortcuts/ipToLocation.py') || "ERROR" // path to the script

    ], {
        env: {
            ...process.env,
            ProgramFiles: process.env.ProgramFiles || 'C:\\Program Files',
            'ProgramFiles(x86)': process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)',
            ProgramW6432: process.env.ProgramW6432 || 'C:\\Program Files',
        }
    });

    let buffer = '';

    pythonProcess.stdout.on('data', async (data: any) => {
        buffer += data.toString();
        const lines = buffer.split('\n');

        buffer = lines.pop() || '';

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            try {


                const security = await callPython("getSecurityIP", { "ip": JSON.parse(trimmed).ip }) as any;

                const parsed = JSON.parse(trimmed);
                parsed.security = security.security; // attach security info to the original payload

                DeskThing.send({
                    type: "ipLocationUpdate",
                    payload: parsed,
                });

            } catch (error) {
                console.error('Error parsing Python output:', error, 'Raw line:', trimmed);
            }
        }
    });

    pythonProcess.stderr.on('data', (data: any) => {
        console.error(`stderr: ${data}`);
    });

    pythonProcess.on('close', (code: any) => {
        console.log(`Python process exited with code ${code}`);
    });


    // ======================================================= IP TO LOCATION SECTION END =======================================================

};

const stop = async () => {

    // kills python processes if they are running. They will also be automatically killed when the main process exits, but this ensures they don't keep running in the background if DeskThing is stopped and restarted.
    if (pythonProcess) pythonProcess.kill();
    if (pythonIpInfo) pythonIpInfo.kill();

};

DeskThing.on(DESKTHING_EVENTS.START, start);
DeskThing.on(DESKTHING_EVENTS.STOP, stop);
