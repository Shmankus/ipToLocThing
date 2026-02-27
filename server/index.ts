import "./polyfills.mjs"; // must be first
////////////////////////////////////////////////////
import { DeskThing } from "@deskthing/server";
import { DESKTHING_EVENTS, SETTING_TYPES } from "@deskthing/types";
import path from "path";
import { createRequire } from 'module';
import { spawn } from "child_process";
import dotenv from "dotenv";
const isDev = process.env.NODE_ENV === 'development';
!isDev && dotenv.config({ path: __dirname + '/../client/shortcuts/.env' });
isDev && dotenv.config();




// !===================== End DeskThing Event Handlers ===================!


export const start = async () => {



const pythonProcess = spawn(process.env.PYTHON_VENV || '../.venv/scripts/python', [
    process.env.PYTHONPATH || path.join(__dirname, '../public/shortcuts/ipToLocation.py')
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
