import { DeskThing } from "@deskthing/server";
import { SETTING_TYPES } from "@deskthing/types";

export const setupSettings = async () => {
  const Settings = {
    statsPollingRate : {
      id: "statsPollingRate",
      type: SETTING_TYPES.NUMBER,
      value: 5,
      min: 1,
      max: 15,
      step: 1,
      label: "Seconds in between stats updates",
      description: "Seconds in between stats updates",
      

    },
    statsPollSamples : {
      id: "statsPollSamples",
      type: SETTING_TYPES.NUMBER,
      value: 20,
      min: 1,
      max: 30,
      step: 1,
      label: "Amount of samples taken for average",
      description: "Amount of samples taken for average",
      

    },
    
    streamMonitorIndex: {
      id: "streamMonitorIndex",
      type: SETTING_TYPES.NUMBER,
      value: 2,
      min: 0,
      max: 4,
      step: 1,
      label: "Stream Monitor Index",
      description: "Index of the monitor to stream",
    },
    upColor: {
      id: "upColor",
      type: SETTING_TYPES.COLOR,
      value: "#00ff00",
      label: "Up/read Color",
      description: "Color for upload and read",
    },
    downColor: {
      id: "downColor",
      type: SETTING_TYPES.COLOR,
      value: "#ff0000",
      label: "Download/Write Color",
      description: "Color for downloads and writes",
    },
     currLattitude: {
      id: "currLattitude",
      type: SETTING_TYPES.NUMBER,
      value: 39.508767030871525,
      min: -90,
      max: 90,
      step: .00001,
      label: "Current lattitude",
      description: "Used for weather",
    },
     currLongitude: {
      id: "currLongitude",
      type: SETTING_TYPES.NUMBER,
      value:  -84.73448862754238,
      min: -180,
      max: 180,
      step: .00001,
      label: "Current Longitude",
      description: "Used for weather",
    },

  };

  DeskThing.initSettings(Settings as any);
  return Settings;
};

//39.508767030871525,-84.73448862754238