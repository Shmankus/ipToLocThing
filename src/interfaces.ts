
    export interface statsInterface {
        cpu: number;
        cpuTemp: number;
        cpuSpeed: number;
        ram: number;
        gpu: number;
        gpuTemp: number;
        gpuUsage: number;
        ping: number;
        networkUp: number;
        networkDown: number;
        freeStorage: number;
        totalStorage: number;
        diskRead: number;
        diskWrite: number;
        fans: { name: string; value: number }[];
    }
export interface NetworkDataPoint { up: number; down: number; time: number; }
