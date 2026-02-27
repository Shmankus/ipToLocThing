import "./polyfills.mjs"; // must be first
////////////////////////////////////////////////////
import { DeskThing } from "@deskthing/server";
import { DESKTHING_EVENTS, SETTING_TYPES } from "@deskthing/types";
import path from "path";
import { createRequire } from 'module';
import { spawn } from "child_process";
import dotenv from "dotenv";
import readline from "readline";
const isDev = process.env.NODE_ENV === 'development';
!isDev && dotenv.config({ path: __dirname + '/../client/shortcuts/.env' }); // In production, the client folder is bundled inside the server, so we need to look for the .env file there
isDev && dotenv.config({ path: __dirname + '/../public/shortcuts/.env' }); // in dev the public folder is visible




// !===================== End DeskThing Event Handlers ===================!


export const start = async () => {



    // ======================================================= IP INFO GATHER SECTION =======================================================
    DeskThing.sendFatal("Starting Python process for IP info");

    const pythonIpInfo = spawn(process.env.PYTHON_VENV || 'python3', [
        process.env.PYTHON_INFO_PATH || "ERROR" // path to the script, NOT the CSV
    ], {
        env: {
            ...process.env,
            ProgramFiles: process.env.ProgramFiles || 'C:\\Program Files',
            'ProgramFiles(x86)': process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)',
            ProgramW6432: process.env.ProgramW6432 || 'C:\\Program Files',
        }
    });

    const rl = readline.createInterface({ input: pythonIpInfo.stdout });

    // Queue to match responses to callers
    const queue = [] as any;
    rl.on("line", (line) => {
        const data = JSON.parse(line);
        if (queue.length > 0) {
            const { resolve } = queue.shift();
            resolve(data);
        } else {
            console.log("Python says:", data); // e.g. the initial "ready" message
        }
    });

    pythonIpInfo.stderr.on("data", (d) => console.error("Python error:", d.toString()));

    // Call a Python function by name
    function callPython(fn: string, args = {}) {
        return new Promise((resolve, reject) => {
            queue.push({ resolve, reject });
            pythonIpInfo.stdin.write(JSON.stringify({ fn, args }) + "\n");
        });
    }





    // ======================================================= IP INFO GATHER SECTION END =======================================================

    // ======================================================= IP TO LOCATION SECTION =======================================================

    if (!process.env.PYTHON_VENV || !process.env.PYTHONPATH) {
        DeskThing.sendFatal("Python environment variables are not set");
        throw new Error("Python environment variables are not set");
    } else {
        const pythonProcess = spawn(process.env.PYTHON_VENV || 'ERROR', [
            process.env.PYTHONPATH || path.join(__dirname, 'ERROR')
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
                    DeskThing.send({
                        type: "ipLocationUpdate",
                        payload: JSON.parse(trimmed),
                    });

                    // TEST CODE TO CHECK IF I CAN CALL PYTHON FUNCTION FROM HERE AND GET THE RESULT, ALSO TESTING SENDING FATAL MESSAGE TO DESKTHING
                    // const security = await callPython("getSecurityIP", { ip: JSON.parse(trimmed).ip });
                    // DeskThing.sendFatal(JSON.stringify(security));


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
    }

    // ======================================================= IP TO LOCATION SECTION END =======================================================

};

const stop = async () => {

};

DeskThing.on(DESKTHING_EVENTS.START, start);
DeskThing.on(DESKTHING_EVENTS.STOP, stop);
