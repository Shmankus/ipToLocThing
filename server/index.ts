import "./polyfills.mjs"; // must be first
////////////////////////////////////////////////////
import { DeskThing } from "@deskthing/server";
import { DESKTHING_EVENTS, SETTING_TYPES } from "@deskthing/types";
import path from "path";
import { createRequire } from 'module';
import { spawn } from "child_process";
import dotenv from "dotenv";
const isDev = process.env.NODE_ENV === 'development';
!isDev && dotenv.config({ path: __dirname + '/../client/shortcuts/.env' }); // In production, the client folder is bundled inside the server, so we need to look for the .env file there
isDev && dotenv.config({ path: __dirname + '/../public/shortcuts/.env' }); // in dev the public folder is visible




// !===================== End DeskThing Event Handlers ===================!


export const start = async () => {



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

pythonProcess.stdout.on('data', (data: any) => {
    buffer += data.toString();
    const lines = buffer.split('\n');
    
    // All lines except the last are complete
    buffer = lines.pop() || '';
    
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
            DeskThing.send({
                type: "ipLocationUpdate",
                payload: JSON.parse(trimmed),
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






};

const stop = async () => {

};

DeskThing.on(DESKTHING_EVENTS.START, start);
DeskThing.on(DESKTHING_EVENTS.STOP, stop);
