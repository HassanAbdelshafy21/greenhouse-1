"use client";

import {
  Activity,
  Camera,
  Cloud,
  Droplets,
  Fan,
  FlaskConical,
  Gauge,
  Leaf,
  Lightbulb,
  RotateCcw,
  Thermometer,
  Settings,
  Square,
  Target,
  Zap,
} from "lucide-react";
import React, { useCallback, useEffect, useState } from "react";
import Image from "next/image";

import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import SensorUtilityCard from "@/components/SensorUtilityCard/SensorUilityCard";
import ActuatorControlCard from "@/components/actuatorControlCard/ActuatorControlCard";
import { Separator } from "@/components/ui/separator";
import Header from "@/components/header/Header";
import CameraFeed from "./_components/CameraFeed";

// Constants
const COMMAND_COOLDOWN = 1000; // 1 second between commands
const USER_ACTION_GRACE_PERIOD = 3000; // 3 seconds after user action
const DATA_FETCH_INTERVAL = 5000; // 5 seconds
const STEPPER_MIN_POSITION = -3200;
const STEPPER_MAX_POSITION = 3200;
const STEPPER_MIN_SPEED = 100;
const STEPPER_MAX_SPEED = 5000;
const STEPPER_MIN_ACCELERATION = 100;
const STEPPER_MAX_ACCELERATION = 3000;

// TypeScript interfaces for API responses
interface SensorData {
  temperature: number;
  humidity: number;
  mq135: number;
  ph: number;
  distance: number;
}

interface DeviceResponse {
  status: string;
  device?: string;
  state?: string;
}

// New interface for ESP32 /api/status endpoint
interface SystemStatus {
  temperature?: number;
  humidity?: number;
  ph?: number;
  mq135?: number;
  distance?: number;
  fan?: string;  // "1" or "0"
  pump1?: string; // "1" or "0"
  pump2?: string; // "1" or "0"
  led?: string;   // "1" or "0"
  stepper_enabled?: string; // "1" or "0"
  wifiConnected?: boolean;
}

const Dashboard = () => {
  // Actuator states (updated for new ESP32 API)
  const [fan, setFan] = useState(false);
  const [pump1, setPump1] = useState(false);
  const [pump2, setPump2] = useState(false);
  const [led, setLed] = useState(false);

  // Stepper motor states
  const [stepperEnabled, setStepperEnabled] = useState(false);
  const [moveDistance, setMoveDistance] = useState(10); // Distance to move in mm
  
  // Connection states
  const [error, setError] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  // Rate limiting state
  const [lastCommandTime, setLastCommandTime] = useState<number>(0);

  // Prevent state sync conflicts during user actions
  const [lastUserAction, setLastUserAction] = useState<number>(0)
  
  // Get ESP32 IP from environment variable
  const espIp = process.env.NEXT_PUBLIC_ESP_IP;

  // Sensor data states
  const [temperature, setTemperature] = useState(0);
  const [humidity, setHumidity] = useState(0);
  const [mq135, setMq135] = useState(0);
  const [ph, setPh] = useState(0);
  const [distance, setDistance] = useState(0);

  // Validate sensor data ranges
  const validateSensorData = (data: Partial<SensorData>): SensorData => {
    return {
      temperature: Math.max(-50, Math.min(100, data.temperature || 0)),
      humidity: Math.max(0, Math.min(100, data.humidity || 0)),
      mq135: Math.max(0, Math.min(1000, data.mq135 || 0)),
      ph: Math.max(0, Math.min(14, data.ph || 0)),
      distance: Math.max(0, Math.min(500, data.distance || 0))
    };
  };

  // Device command function for new ESP32 API (GET with query parameters)
  const sendDeviceCommand = async (device: string, state: boolean): Promise<boolean> => {
    // Rate limiting check
    const now = Date.now();
    if (now - lastCommandTime < COMMAND_COOLDOWN) {
      return false;
    }
    setLastCommandTime(now);
    setLastUserAction(now); // Mark user action time

    const targetState = state ? "0" : "1";  // Inverted: UI ON sends "0" to ESP32

    try {
      // Use new ESP32 control API with query parameters
      const url = `http://${espIp}/api/control?${device}=${targetState}`;

      const res = await fetch(url, {
        method: 'GET',
        headers: {
          'Accept': 'text/plain',
        },
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }

      const result = await res.text();

      // ESP32 returns "OK" on success
      if (result.trim() !== 'OK') {
        throw new Error(`Unexpected response: ${result}`);
      }

      // Clear any previous errors
      setError(null);
      return true;

    } catch (err) {
      const errorMessage = `Failed to control ${device}: ${err}`;
      setError(errorMessage);
      return false;
    }
  };

  // Enhanced system status fetching using new ESP32 API
  const fetchSensorData = useCallback(async () => {
    try {
      const url = `http://${espIp}/api/status`;

      const res = await fetch(url, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
        },
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }

      const systemStatus: SystemStatus = await res.json();

      // Validate system status data
      if (!systemStatus || typeof systemStatus !== 'object') {
        throw new Error('Invalid system status format received');
      }

      // Update sensor data
      setTemperature(systemStatus.temperature || 0);
      setHumidity(systemStatus.humidity || 0);
      setMq135(systemStatus.mq135 || 0);
      setPh(systemStatus.ph || 0);
      setDistance(systemStatus.distance || 0);

      // Update device states from ESP32 (sync with actual hardware state)
      // Only sync if no recent user action to prevent conflicts
      const now = Date.now();
      const timeSinceUserAction = now - lastUserAction;

      if (timeSinceUserAction > USER_ACTION_GRACE_PERIOD) {
        setFan(systemStatus.fan === "0");  // Inverted: ESP32 "0" means UI ON
        setPump1(systemStatus.pump1 === "0");
        setPump2(systemStatus.pump2 === "0");
        setLed(systemStatus.led === "0");
        setStepperEnabled(systemStatus.stepper_enabled === "1");
      }

      // Update connection status
      setIsConnected(true);
      setError(null);
      setLastUpdate(new Date());

    } catch (err) {
      const errorMessage = `Failed to fetch system status: ${err}`;
      setError(errorMessage);
      setIsConnected(false);
    }
  }, [espIp, lastUserAction]);

  // Device control functions with state management
  const toggleFan = async () => {
    const newState = !fan;
    const success = await sendDeviceCommand("fan", newState);
    if (success) {
      setFan(newState);
    }
  };

  const togglePump1 = async () => {
    const newState = !pump1;
    const success = await sendDeviceCommand("pump1", newState);
    if (success) {
      setPump1(newState);
    }
  };

  const toggleLed = async () => {
    const newState = !led;
    const success = await sendDeviceCommand("led", newState);
    if (success) {
      setLed(newState);
    }
  };

  const togglePump2 = async () => {
    const newState = !pump2;
    const success = await sendDeviceCommand("pump2", newState);
    if (success) {
      setPump2(newState);
    }
  };

  // Stepper motor control functions
  const toggleStepperEnable = async () => {
    const newState = !stepperEnabled;

    try {
      const url = `http://${espIp}/api/control?stepper_enable=${newState ? "1" : "0"}`;
      const res = await fetch(url, { method: 'GET' });

      if (res.ok) {
        setStepperEnabled(newState);
        setLastUserAction(Date.now());
        setError(null);
      } else {
        throw new Error(`HTTP ${res.status}`);
      }
    } catch (err) {
      const errorMessage = `Stepper enable error: ${err}`;
      setError(errorMessage);
    }
  };

  const moveStepperForward = async () => {
    if (!stepperEnabled) {
      setError("Stepper not enabled. Enable it first!");
      return;
    }

    const now = Date.now();
    if (now - lastCommandTime < COMMAND_COOLDOWN) {
      return;
    }
    setLastCommandTime(now);
    setLastUserAction(now);

    try {
      const url = `http://${espIp}/api/control?stepper_move=${moveDistance}`;
      const res = await fetch(url, { method: 'GET' });

      if (res.ok) {
        setError(null);
      } else {
        throw new Error(`HTTP ${res.status}`);
      }
    } catch (err) {
      const errorMessage = `Forward move error: ${err}`;
      setError(errorMessage);
    }
  };

  const moveStepperBackward = async () => {
    if (!stepperEnabled) {
      setError("Stepper not enabled. Enable it first!");
      return;
    }

    const now = Date.now();
    if (now - lastCommandTime < COMMAND_COOLDOWN) {
      return;
    }
    setLastCommandTime(now);
    setLastUserAction(now);

    try {
      const url = `http://${espIp}/api/control?stepper_move_back=${moveDistance}`;
      const res = await fetch(url, { method: 'GET' });

      if (res.ok) {
        setError(null);
      } else {
        throw new Error(`HTTP ${res.status}`);
      }
    } catch (err) {
      const errorMessage = `Backward move error: ${err}`;
      setError(errorMessage);
    }
  };


  // Group control functions
  const handleAllPumpsOn = async () => {
    const success1 = await sendDeviceCommand("pump1", true);
    const success2 = await sendDeviceCommand("pump2", true);
    if (success1) setPump1(true);
    if (success2) setPump2(true);
  };

  const handleAllPumpsOff = async () => {
    const success1 = await sendDeviceCommand("pump1", false);
    const success2 = await sendDeviceCommand("pump2", false);
    if (success1) setPump1(false);
    if (success2) setPump2(false);
  };

  const handleAllOff = async () => {
    const results = await Promise.all([
      sendDeviceCommand("fan", false),
      sendDeviceCommand("pump1", false),
      sendDeviceCommand("pump2", false),
      sendDeviceCommand("led", false)
    ]);

    if (results[0]) setFan(false);
    if (results[1]) setPump1(false);
    if (results[2]) setPump2(false);
    if (results[3]) setLed(false);
  };

  // Connection test function
  const testConnection = async () => {
    try {
      const response = await fetch(`http://${espIp}/api/status`);
      if (response.ok) {
        fetchSensorData();
      }
    } catch (err) {
      setError(`Connection test failed: ${err}`);
    }
  };

  // Initialize data fetching
  useEffect(() => {
    if (!espIp) {
      const errorMsg = "ESP32 IP not configured. Please set NEXT_PUBLIC_ESP_IP in your .env.local file";
      setError(errorMsg);
      return;
    }

    // Initial fetch
    fetchSensorData();

    // Set up interval to fetch data
    const interval = setInterval(fetchSensorData, DATA_FETCH_INTERVAL);

    // Cleanup interval on component unmount
    return () => {
      clearInterval(interval);
    };
  }, [espIp, fetchSensorData]);

  // Helper function to get sensor status
  const getSensorStatus = (value: number, min: number, max: number) => {
    if (value >= min && value <= max) {
      return "Normal";
    }
    return "Warning";
  };

  return (
    <div className="min-h-screen w-full flex flex-col gap-8 items-center bg-gradient-to-br from-green-50 to-emerald-100 pb-4">
      {/* Header */}
      <div className="w-full px-6">
        <Header />
        <Separator className="my-2 h-[20px]" />
      </div>

      {/* Connection Status */}
      <div className="flex items-center gap-4">
        <div className={`w-3 h-3 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'}`}></div>
        <span className="text-sm">
          {isConnected ? 'Connected to ESP32' : 'Disconnected'}
        </span>
        {lastUpdate && (
          <span className="text-xs text-gray-500">
            Last update: {lastUpdate.toLocaleTimeString()}
          </span>
        )}
        <button
          onClick={testConnection}
          className="px-3 py-1 bg-blue-500 text-white rounded text-xs hover:bg-blue-600"
          aria-label="Test ESP32 connection"
        >
          Test Connection
        </button>
      </div>

      {/* Error Display */}
      {error && (
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded max-w-md text-center">
          <strong>Connection Error:</strong> {error}
          <br />
          <small>ESP32 IP: {espIp || 'Not configured'}</small>
          <br />
          <button
            onClick={fetchSensorData}
            className="mt-2 px-3 py-1 bg-red-600 text-white rounded text-sm hover:bg-red-700"
            aria-label="Retry connection to ESP32"
          >
            Retry Connection
          </button>
        </div>
      )}

      {/* Hero Section */}
      <section className="flex flex-col items-center gap-2 text-center">
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <Leaf className="w-10 h-10" />
          Greenhouse Control Center
        </h1>
        <p>Monitor and control your greenhouse environment</p>
      </section>

      {/* Sensor Utilities */}
      <section className="flex items-center gap-4 flex-wrap justify-center">
        <SensorUtilityCard
          icon={<Thermometer />}
          label="Temperature"
          data={`${temperature.toFixed(1)}°C`}
          status={getSensorStatus(temperature, 20, 30)}
          hint="Optimal range: 20°C - 30°C"
        />
        <SensorUtilityCard
          icon={<Droplets />}
          label="Humidity"
          data={`${humidity.toFixed(1)}%`}
          status={getSensorStatus(humidity, 20, 60)}
          hint="Optimal range: 20% - 60%"
        />
        <SensorUtilityCard
          icon={<FlaskConical />}
          label="pH Level"
          data={`${ph.toFixed(2)}`}
          status={getSensorStatus(ph, 6.0, 7.5)}
          hint="Optimal range: 6.0 - 7.5"
        />
        <SensorUtilityCard
          icon={<Gauge />}
          label="Water Level"
          data={`${distance.toFixed(1)} cm`}
          status={getSensorStatus(distance, 20, 40)}
          hint="Optimal range: 20 cm - 40 cm"
        />
        <SensorUtilityCard
          icon={<Cloud />}
          label="Air Quality"
          data={`${mq135} ppm`}
          status={getSensorStatus(mq135, 100, 200)}
          hint="Optimal range: 100 - 200 ppm"
        />
        <SensorUtilityCard
          icon={<Settings />}
          label="Stepper Motor"
          data={stepperEnabled ? "Enabled" : "Disabled"}
          status={stepperEnabled ? "Ready" : "Disabled"}
          hint={`Motor is ${stepperEnabled ? 'ready for manual control' : 'disabled'}`}
        />
      </section>

      {/* Camera Feed */}
      <CameraFeed />

      {/* Actuator Controls */}
      <section className="flex flex-wrap gap-4 w-[60%] items-center justify-center">
        <ActuatorControlCard
          actuatorIcon={<Fan />}
          actuatorName="Fan"
          status={fan}
          onToggle={toggleFan}
        />
        <ActuatorControlCard
          actuatorIcon={<Lightbulb />}
          actuatorName="LED Strip"
          status={led}
          onToggle={toggleLed}
        />
        <ActuatorControlCard
          actuatorIcon={<RotateCcw />}
          actuatorName="Pump 1"
          status={pump1}
          onToggle={togglePump1}
        />
        <ActuatorControlCard
          actuatorIcon={<RotateCcw />}
          actuatorName="Pump 2"
          status={pump2}
          onToggle={togglePump2}
        />
        <ActuatorControlCard
          actuatorIcon={<Settings />}
          actuatorName="Stepper Motor"
          status={stepperEnabled}
          onToggle={toggleStepperEnable}
        />
      </section>

      {/* Stepper Motor Controls */}
      {stepperEnabled && (
        <section className="flex flex-wrap gap-4 justify-center items-start">
          {/* Manual Movement Controls */}
          <div className="bg-white rounded-lg shadow-md p-4 min-w-[350px]">
            <h3 className="font-semibold text-gray-700 mb-3 flex items-center gap-2">
              <Target className="w-4 h-4" />
              Manual Movement Controls
            </h3>

            {/* Distance input */}
            <div className="mb-4">
              <label className="block text-sm text-gray-600 mb-2">
                Distance to move (mm):
              </label>
              <input
                type="number"
                value={moveDistance}
                onChange={(e) => setMoveDistance(parseFloat(e.target.value) || 0)}
                min="1"
                max="100"
                step="1"
                className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="text-xs text-gray-500 mt-1">Range: 1-100mm</p>
            </div>

            {/* Control buttons */}
            <div className="flex flex-col gap-2">
              <button
                onClick={moveStepperForward}
                className="w-full px-4 py-3 bg-blue-500 text-white rounded hover:bg-blue-600 flex items-center justify-center gap-2"
                aria-label="Move stepper forward"
              >
                ➡️ Move Forward {moveDistance}mm
              </button>
              <button
                onClick={moveStepperBackward}
                className="w-full px-4 py-3 bg-purple-500 text-white rounded hover:bg-purple-600 flex items-center justify-center gap-2"
                aria-label="Move stepper backward"
              >
                ⬅️ Move Backward {moveDistance}mm
              </button>
            </div>
          </div>

          {/* Motor Settings */}
          <div className="bg-white rounded-lg shadow-md p-4 min-w-[250px]">
            <h3 className="font-semibold text-gray-700 mb-3 flex items-center gap-2">
              <Zap className="w-4 h-4" />
              Motor Configuration
            </h3>
            <div className="space-y-3 text-sm text-gray-600">
              <div className="flex justify-between">
                <span>Steps per mm:</span>
                <span className="font-semibold">400 steps/mm</span>
              </div>
              <div className="flex justify-between">
                <span>Travel Range:</span>
                <span className="font-semibold">100mm</span>
              </div>
              <div className="flex justify-between">
                <span>Speed Delay:</span>
                <span className="font-semibold">250 μs</span>
              </div>
              <div className="flex justify-between">
                <span>Mode:</span>
                <span className="font-semibold text-green-600">Direct Pin Control</span>
              </div>
              <div className="flex justify-between">
                <span>Control:</span>
                <span className="font-semibold text-blue-600">Blocking</span>
              </div>
            </div>
            <div className="mt-4 p-2 bg-yellow-50 border border-yellow-200 rounded">
              <p className="text-xs text-yellow-800">
                ⚠️ Motor movement is blocking. Wait for completion before next command.
              </p>
            </div>
          </div>

        </section>
      )}

      {/* Manual Controls */}
      <section className="flex gap-4 flex-wrap justify-center">
        <button
          onClick={handleAllPumpsOn}
          className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
          aria-label="Turn all pumps on"
        >
          All Pumps ON
        </button>
        <button
          onClick={handleAllPumpsOff}
          className="px-4 py-2 bg-gray-500 text-white rounded hover:bg-gray-600"
          aria-label="Turn all pumps off"
        >
          All Pumps OFF
        </button>
        <button
          onClick={handleAllOff}
          className="px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600"
          aria-label="Emergency: turn all devices off"
        >
          🚨 ALL OFF
        </button>
      </section>

    </div>
  );
};

export default Dashboard;