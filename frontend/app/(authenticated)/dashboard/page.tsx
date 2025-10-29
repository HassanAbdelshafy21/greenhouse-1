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
  Home,
  ChevronLeft,
  ChevronRight,
  Square,
  Target,
  Zap,
  Rocket,
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
const DEBUG_MESSAGE_LIMIT = 10; // Keep last 10 debug messages
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
  stepper_auto?: string; // "1" or "0"
  stepper_position?: string; // position as string
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
  const [stepperAuto, setStepperAuto] = useState(true); // Auto mode state
  const [stepperPosition, setStepperPosition] = useState(0);
  const [stepperSpeed, setStepperSpeed] = useState(1000);
  const [stepperAcceleration, setStepperAcceleration] = useState(500);
  const [targetPosition, setTargetPosition] = useState(0);
  
  // Connection states
  const [error, setError] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [debugInfo, setDebugInfo] = useState<string[]>([]);

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

  // Add debug message function
  const addDebugMessage = useCallback((message: string) => {
    const timestamp = new Date().toLocaleTimeString();
    const debugMessage = `${timestamp}: ${message}`;
    console.log(debugMessage);
    setDebugInfo(prev => [...prev.slice(-(DEBUG_MESSAGE_LIMIT - 1)), debugMessage]);
  }, []);

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
      addDebugMessage(`⏳ Rate limit: Please wait ${Math.ceil((COMMAND_COOLDOWN - (now - lastCommandTime)) / 1000)}s`);
      return false;
    }
    setLastCommandTime(now);
    setLastUserAction(now); // Mark user action time

    const targetState = state ? "0" : "1";  // Inverted: UI ON sends "0" to ESP32
    addDebugMessage(`🚀 Sending ${device} → ${targetState} (UI: ${state ? "ON" : "OFF"})`);

    try {
      // Use new ESP32 control API with query parameters
      const url = `http://${espIp}/api/control?${device}=${targetState}`;

      addDebugMessage(`📡 GET ${url}`);

      const res = await fetch(url, {
        method: 'GET',
        headers: {
          'Accept': 'text/plain',
        },
      });

      addDebugMessage(`📬 Response: ${res.status} ${res.statusText}`);

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }

      const result = await res.text();

      // ESP32 returns "OK" on success
      if (result.trim() !== 'OK') {
        throw new Error(`Unexpected response: ${result}`);
      }

      addDebugMessage(`✅ Success: ${result}`);

      // Clear any previous errors
      setError(null);
      return true;

    } catch (err) {
      const errorMessage = `Failed to control ${device}: ${err}`;
      addDebugMessage(`❌ Error: ${errorMessage}`);
      setError(errorMessage);
      return false;
    }
  };

  // Enhanced system status fetching using new ESP32 API
  const fetchSensorData = useCallback(async () => {
    try {
      const url = `http://${espIp}/api/status`;
      addDebugMessage(`📊 Fetching system status from ${url}`);

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

      addDebugMessage(`📈 System status received: ${Object.keys(systemStatus).length} fields`);

      // Update sensor data
      setTemperature(systemStatus.temperature || 0);
      setHumidity(systemStatus.humidity || 0);
      setMq135(systemStatus.mq135 || 0);
      setPh(systemStatus.ph || 0);
      setDistance(systemStatus.distance || 0);

      // Update stepper position (always sync this)
      setStepperPosition(parseInt(systemStatus.stepper_position || "0", 10));

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
        setStepperAuto(systemStatus.stepper_auto === "1");
        addDebugMessage(`🔄 Device states synced from ESP32`);
      } else {
        addDebugMessage(`⏸️ Skipping state sync (${Math.ceil((USER_ACTION_GRACE_PERIOD - timeSinceUserAction) / 1000)}s remaining)`);
      }

      // Update connection status
      setIsConnected(true);
      setError(null);
      setLastUpdate(new Date());

      addDebugMessage(`📊 ESP32 states: Fan=${systemStatus.fan}, Pump1=${systemStatus.pump1}, Pump2=${systemStatus.pump2}, LED=${systemStatus.led}`);

    } catch (err) {
      const errorMessage = `Failed to fetch system status: ${err}`;
      addDebugMessage(`❌ System status error: ${errorMessage}`);
      setError(errorMessage);
      setIsConnected(false);
    }
  }, [espIp, addDebugMessage, lastUserAction]);

  // Device control functions with state management
  const toggleFan = async () => {
    const newState = !fan;
    addDebugMessage(`🌀 Fan toggle: ${fan} → ${newState}`);
    const success = await sendDeviceCommand("fan", newState);
    if (success) {
      setFan(newState);
      addDebugMessage(`✅ Fan state updated locally`);
    }
  };

  const togglePump1 = async () => {
    const newState = !pump1;
    addDebugMessage(`🚿 Pump 1 toggle: ${pump1} → ${newState}`);
    const success = await sendDeviceCommand("pump1", newState);
    if (success) {
      setPump1(newState);
      addDebugMessage(`✅ Pump 1 state updated locally`);
    }
  };

  const toggleLed = async () => {
    const newState = !led;
    addDebugMessage(`💡 LED toggle: ${led} → ${newState}`);
    const success = await sendDeviceCommand("led", newState);
    if (success) {
      setLed(newState);
      addDebugMessage(`✅ LED state updated locally`);
    }
  };

  const togglePump2 = async () => {
    const newState = !pump2;
    addDebugMessage(`🚰 Pump 2 toggle: ${pump2} → ${newState}`);
    const success = await sendDeviceCommand("pump2", newState);
    if (success) {
      setPump2(newState);
      addDebugMessage(`✅ Pump 2 state updated locally`);
    }
  };

  // Stepper motor control functions
  const toggleStepperEnable = async () => {
    const newState = !stepperEnabled;
    addDebugMessage(`⚙️ Stepper enable toggle: ${stepperEnabled} → ${newState}`);

    try {
      const url = `http://${espIp}/api/control?stepper_enable=${newState ? "1" : "0"}`;
      const res = await fetch(url, { method: 'GET' });

      if (res.ok) {
        setStepperEnabled(newState);
        setLastUserAction(Date.now());
        addDebugMessage(`✅ Stepper enable updated: ${newState}`);
        setError(null);
      } else {
        throw new Error(`HTTP ${res.status}`);
      }
    } catch (err) {
      const errorMessage = `Stepper enable error: ${err}`;
      addDebugMessage(`❌ ${errorMessage}`);
      setError(errorMessage);
    }
  };

  const moveStepperLeft = async () => {
    if (!stepperEnabled) {
      addDebugMessage(`❌ Stepper not enabled - Enable it first!`);
      return;
    }

    // Rate limiting check
    const now = Date.now();
    if (now - lastCommandTime < COMMAND_COOLDOWN) {
      addDebugMessage(`⏳ Rate limit: Please wait ${Math.ceil((COMMAND_COOLDOWN - (now - lastCommandTime)) / 1000)}s`);
      return;
    }
    setLastCommandTime(now);
    setLastUserAction(now);

    addDebugMessage(`⬅️ LEFT button pressed - Moving 200 steps left (direct stepping)`);

    try {
      const url = `http://${espIp}/api/control?stepper_move=left`;
      const res = await fetch(url, { method: 'GET' });

      if (res.ok) {
        addDebugMessage(`✅ LEFT movement complete! Check Serial Monitor for details.`);
        setError(null);
      } else {
        throw new Error(`HTTP ${res.status}`);
      }
    } catch (err) {
      const errorMessage = `Stepper left error: ${err}`;
      addDebugMessage(`❌ ${errorMessage}`);
      setError(errorMessage);
    }
  };

  const moveStepperRight = async () => {
    if (!stepperEnabled) {
      addDebugMessage(`❌ Stepper not enabled - Enable it first!`);
      return;
    }

    // Rate limiting check
    const now = Date.now();
    if (now - lastCommandTime < COMMAND_COOLDOWN) {
      addDebugMessage(`⏳ Rate limit: Please wait ${Math.ceil((COMMAND_COOLDOWN - (now - lastCommandTime)) / 1000)}s`);
      return;
    }
    setLastCommandTime(now);
    setLastUserAction(now);

    addDebugMessage(`➡️ RIGHT button pressed - Moving 200 steps right (direct stepping)`);

    try {
      const url = `http://${espIp}/api/control?stepper_move=right`;
      const res = await fetch(url, { method: 'GET' });

      if (res.ok) {
        addDebugMessage(`✅ RIGHT movement complete! Check Serial Monitor for details.`);
        setError(null);
      } else {
        throw new Error(`HTTP ${res.status}`);
      }
    } catch (err) {
      const errorMessage = `Stepper right error: ${err}`;
      addDebugMessage(`❌ ${errorMessage}`);
      setError(errorMessage);
    }
  };

  // HOME button removed - not needed

  const moveToPosition = async () => {
    if (!stepperEnabled) {
      addDebugMessage(`❌ Stepper not enabled`);
      return;
    }

    // Rate limiting check
    const now = Date.now();
    if (now - lastCommandTime < COMMAND_COOLDOWN) {
      addDebugMessage(`⏳ Rate limit: Please wait`);
      return;
    }
    setLastCommandTime(now);
    setLastUserAction(now);

    addDebugMessage(`📍 Moving to position: ${targetPosition}`);

    try {
      const url = `http://${espIp}/api/control?stepper_position=${targetPosition}`;
      const res = await fetch(url, { method: 'GET' });

      if (res.ok) {
        addDebugMessage(`✅ Moving to position ${targetPosition}`);
        setError(null);
      } else {
        throw new Error(`HTTP ${res.status}`);
      }
    } catch (err) {
      const errorMessage = `Position move error: ${err}`;
      addDebugMessage(`❌ ${errorMessage}`);
      setError(errorMessage);
    }
  };

  const setMotorSpeed = async (speed: number) => {
    addDebugMessage(`⚡ Setting motor speed: ${speed}`);

    try {
      const url = `http://${espIp}/api/control?stepper_speed=${speed}`;
      const res = await fetch(url, { method: 'GET' });

      if (res.ok) {
        setStepperSpeed(speed);
        setLastUserAction(Date.now());
        addDebugMessage(`✅ Speed set to ${speed}`);
        setError(null);
      } else {
        throw new Error(`HTTP ${res.status}`);
      }
    } catch (err) {
      const errorMessage = `Speed setting error: ${err}`;
      addDebugMessage(`❌ ${errorMessage}`);
      setError(errorMessage);
    }
  };

  const setMotorAcceleration = async (acceleration: number) => {
    addDebugMessage(`🚀 Setting motor acceleration: ${acceleration}`);

    try {
      const url = `http://${espIp}/api/control?stepper_acceleration=${acceleration}`;
      const res = await fetch(url, { method: 'GET' });

      if (res.ok) {
        setStepperAcceleration(acceleration);
        setLastUserAction(Date.now());
        addDebugMessage(`✅ Acceleration set to ${acceleration}`);
        setError(null);
      } else {
        throw new Error(`HTTP ${res.status}`);
      }
    } catch (err) {
      const errorMessage = `Acceleration setting error: ${err}`;
      addDebugMessage(`❌ ${errorMessage}`);
      setError(errorMessage);
    }
  };

  const stopMotor = async () => {
    addDebugMessage(`🛑 Stopping motor`);

    try {
      const url = `http://${espIp}/api/control?stepper_stop=1`;
      const res = await fetch(url, { method: 'GET' });

      if (res.ok) {
        setLastUserAction(Date.now());
        addDebugMessage(`✅ Motor stopped`);
        setError(null);
      } else {
        throw new Error(`HTTP ${res.status}`);
      }
    } catch (err) {
      const errorMessage = `Stop motor error: ${err}`;
      addDebugMessage(`❌ ${errorMessage}`);
      setError(errorMessage);
    }
  };

  const toggleAutoMode = async () => {
    const newState = !stepperAuto;
    addDebugMessage(`🔄 Auto mode toggle: ${stepperAuto} → ${newState}`);

    try {
      const url = `http://${espIp}/api/control?stepper_auto=${newState ? "1" : "0"}`;
      const res = await fetch(url, { method: 'GET' });

      if (res.ok) {
        setStepperAuto(newState);
        setLastUserAction(Date.now());
        addDebugMessage(`✅ Auto mode ${newState ? 'enabled' : 'disabled'}`);
        setError(null);
      } else {
        throw new Error(`HTTP ${res.status}`);
      }
    } catch (err) {
      const errorMessage = `Auto mode error: ${err}`;
      addDebugMessage(`❌ ${errorMessage}`);
      setError(errorMessage);
    }
  };

  const runHardwareTest = async () => {
    addDebugMessage(`🔧 Running hardware test...`);

    try {
      const url = `http://${espIp}/api/test`;
      const res = await fetch(url, { method: 'GET' });

      if (res.ok) {
        const result = await res.text();
        addDebugMessage(`✅ Hardware test initiated: ${result}`);
        addDebugMessage(`📺 Check Serial Monitor for test results`);
        setError(null);
      } else {
        throw new Error(`HTTP ${res.status}`);
      }
    } catch (err) {
      const errorMessage = `Hardware test error: ${err}`;
      addDebugMessage(`❌ ${errorMessage}`);
      setError(errorMessage);
    }
  };

  const runDirectStep = async (steps: number) => {
    if (!stepperEnabled) {
      addDebugMessage(`❌ Stepper not enabled`);
      return;
    }

    addDebugMessage(`⚡ Running direct step test: ${steps} steps`);

    try {
      const url = `http://${espIp}/api/control?direct_step=${steps}`;
      const res = await fetch(url, { method: 'GET' });

      if (res.ok) {
        const result = await res.text();
        addDebugMessage(`✅ Direct step complete: ${result}`);
        addDebugMessage(`🎯 If motor moved, AccelStepper is the problem`);
        setError(null);
      } else {
        throw new Error(`HTTP ${res.status}`);
      }
    } catch (err) {
      const errorMessage = `Direct step error: ${err}`;
      addDebugMessage(`❌ ${errorMessage}`);
      setError(errorMessage);
    }
  };

  // Group control functions
  const handleAllPumpsOn = async () => {
    addDebugMessage(`🚿 All pumps ON requested`);
    const success1 = await sendDeviceCommand("pump1", true);
    const success2 = await sendDeviceCommand("pump2", true);
    if (success1) setPump1(true);
    if (success2) setPump2(true);
    addDebugMessage(`🚿 All pumps result: Pump1=${success1}, Pump2=${success2}`);
  };

  const handleAllPumpsOff = async () => {
    addDebugMessage(`🔇 All pumps OFF requested`);
    const success1 = await sendDeviceCommand("pump1", false);
    const success2 = await sendDeviceCommand("pump2", false);
    if (success1) setPump1(false);
    if (success2) setPump2(false);
    addDebugMessage(`🔇 All pumps result: Pump1=${success1}, Pump2=${success2}`);
  };

  const handleAllOff = async () => {
    addDebugMessage(`🚨 EMERGENCY ALL OFF requested`);
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
    
    addDebugMessage(`🚨 Emergency stop result: ${results.filter(r => r).length}/${results.length} succeeded`);
  };

  // Connection test function
  const testConnection = async () => {
    addDebugMessage(`🔧 Testing ESP32 connection...`);
    try {
      const response = await fetch(`http://${espIp}/api/status`);
      if (response.ok) {
        addDebugMessage(`✅ ESP32 connection test successful`);
        fetchSensorData();
      } else {
        addDebugMessage(`❌ ESP32 connection test failed: ${response.status}`);
      }
    } catch (err) {
      addDebugMessage(`❌ ESP32 connection test error: ${err}`);
    }
  };

  // Initialize data fetching
  useEffect(() => {
    if (!espIp) {
      const errorMsg = "ESP32 IP not configured. Please set NEXT_PUBLIC_ESP_IP in your .env.local file";
      setError(errorMsg);
      addDebugMessage(`❌ ${errorMsg}`);
      return;
    }

    addDebugMessage(`🚀 Dashboard initialized with ESP32 IP: ${espIp}`);

    // Initial fetch
    fetchSensorData();

    // Set up interval to fetch data
    const interval = setInterval(fetchSensorData, DATA_FETCH_INTERVAL);

    // Cleanup interval on component unmount
    return () => {
      clearInterval(interval);
      addDebugMessage(`🔄 Data fetching interval cleared`);
    };
  }, [espIp, fetchSensorData, addDebugMessage]);

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
          label="Stepper Position"
          data={`${stepperPosition} steps`}
          status={stepperEnabled ? (stepperAuto ? "Auto Mode" : "Manual") : "Disabled"}
          hint={`Motor is ${stepperEnabled ? (stepperAuto ? 'auto mode' : 'manual mode') : 'disabled'}`}
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

      {/* Enhanced Stepper Motor Controls */}
      {stepperEnabled && (
        <section className="flex flex-wrap gap-4 justify-center items-start">
          {/* Manual Movement Controls */}
          <div className="bg-white rounded-lg shadow-md p-4 min-w-[300px]">
            <h3 className="font-semibold text-gray-700 mb-3 flex items-center gap-2">
              <Target className="w-4 h-4" />
              Manual Controls
            </h3>

            {/* LEFT and RIGHT buttons */}
            <div className="flex items-center justify-center gap-4 mb-4">
              <button
                onClick={moveStepperLeft}
                className="px-8 py-4 bg-blue-500 text-white rounded-lg hover:bg-blue-600 flex items-center gap-2 font-bold text-lg shadow-md transition-all hover:scale-105"
                aria-label="Move motor left 200 steps"
              >
                <ChevronLeft className="w-6 h-6" />
                LEFT
              </button>
              <button
                onClick={moveStepperRight}
                className="px-8 py-4 bg-blue-500 text-white rounded-lg hover:bg-blue-600 flex items-center gap-2 font-bold text-lg shadow-md transition-all hover:scale-105"
                aria-label="Move motor right 200 steps"
              >
                RIGHT
                <ChevronRight className="w-6 h-6" />
              </button>
            </div>

            {/* Position display */}
            <div className="text-center mb-4 p-3 bg-gray-100 rounded">
              <p className="text-xs text-gray-600 mb-1">Current Position</p>
              <p className="text-2xl font-bold text-gray-800">{stepperPosition}</p>
              <p className="text-xs text-gray-500">steps</p>
            </div>

            {/* Control buttons */}
            <div className="flex justify-center gap-2">
              <button
                onClick={stopMotor}
                className="px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600 flex items-center gap-2 text-sm"
                aria-label="Stop motor immediately"
              >
                <Square className="w-4 h-4" />
                STOP
              </button>
              <button
                onClick={toggleAutoMode}
                className={`px-4 py-2 rounded flex items-center gap-2 text-sm ${
                  stepperAuto
                    ? 'bg-orange-500 text-white hover:bg-orange-600'
                    : 'bg-gray-500 text-white hover:bg-gray-600'
                }`}
                aria-label="Toggle auto mode"
              >
                <RotateCcw className="w-4 h-4" />
                {stepperAuto ? 'Disable Auto' : 'Enable Auto'}
              </button>
            </div>
          </div>

          {/* Auto Mode Status */}
          <div className="bg-white rounded-lg shadow-md p-4 min-w-[300px]">
            <h3 className="font-semibold text-gray-700 mb-3 flex items-center gap-2">
              <Activity className="w-4 h-4" />
              Auto Mode Status
            </h3>
            <div className="flex items-center justify-center gap-3 mb-3">
              <div className={`w-4 h-4 rounded-full ${stepperAuto ? 'bg-green-500 animate-pulse' : 'bg-gray-300'}`}></div>
              <span className="text-lg font-semibold">
                {stepperAuto ? '🔄 Running' : 'Manual Mode'}
              </span>
            </div>
            <p className="text-sm text-gray-600 text-center mb-3">
              {stepperAuto
                ? 'Motor automatically moves between -100mm and +100mm'
                : 'Use manual controls to move motor'}
            </p>
            <div className="text-center">
              <p className="text-xs text-gray-400">
                {stepperAuto ? 'Click "Disable Auto" to use manual controls' : 'Click "Enable Auto" for automatic movement'}
              </p>
            </div>
          </div>

          {/* Motor Settings */}
          <div className="bg-white rounded-lg shadow-md p-4 min-w-[250px]">
            <h3 className="font-semibold text-gray-700 mb-3 flex items-center gap-2">
              <Zap className="w-4 h-4" />
              Motor Settings
            </h3>
            <div className="space-y-3 text-sm text-gray-600">
              <div className="flex justify-between">
                <span>Speed:</span>
                <span className="font-semibold">200 steps/sec</span>
              </div>
              <div className="flex justify-between">
                <span>Acceleration:</span>
                <span className="font-semibold">100 steps/sec²</span>
              </div>
              <div className="flex justify-between">
                <span>Travel Range:</span>
                <span className="font-semibold">±100mm</span>
              </div>
              <div className="flex justify-between">
                <span>Microsteps:</span>
                <span className="font-semibold">Full Step (1:1)</span>
              </div>
              <div className="flex justify-between">
                <span>Mode:</span>
                <span className="font-semibold text-green-600">Max Torque</span>
              </div>
            </div>
          </div>

          {/* Hardware Test Card */}
          <div className="bg-white rounded-lg shadow-md p-4 min-w-[250px]">
            <h3 className="font-semibold text-gray-700 mb-3 flex items-center gap-2">
              <Rocket className="w-4 h-4" />
              Diagnostics
            </h3>
            <p className="text-sm text-gray-600 mb-3">
              Test motor hardware and troubleshoot issues
            </p>
            <div className="space-y-2">
              <button
                onClick={runHardwareTest}
                className="w-full px-4 py-2 bg-purple-500 text-white rounded hover:bg-purple-600 flex items-center justify-center gap-2 text-sm"
                aria-label="Run hardware test"
              >
                <Rocket className="w-4 h-4" />
                Hardware Test
              </button>
              <button
                onClick={() => runDirectStep(100)}
                className="w-full px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 flex items-center justify-center gap-2 text-sm"
                aria-label="Direct step test 100 steps"
              >
                <Zap className="w-4 h-4" />
                Direct Step (100)
              </button>
              <button
                onClick={() => runDirectStep(-100)}
                className="w-full px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 flex items-center justify-center gap-2 text-sm"
                aria-label="Direct step test -100 steps"
              >
                <Zap className="w-4 h-4" />
                Direct Step (-100)
              </button>
            </div>
            <p className="text-xs text-gray-500 mt-2 text-center">
              Direct step bypasses AccelStepper
            </p>
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

      {/* Debug Console */}
      {process.env.NODE_ENV === 'development' && (
        <section className="bg-gray-900 text-green-400 p-4 rounded text-xs max-w-4xl w-full">
          <div className="flex justify-between items-center mb-2">
            <h3 className="font-bold text-green-300">Debug Console</h3>
            <button
              onClick={() => setDebugInfo([])}
              className="px-2 py-1 bg-red-600 text-white rounded text-xs"
              aria-label="Clear debug console"
            >
              Clear
            </button>
          </div>
          <div className="max-h-40 overflow-y-auto space-y-1">
            {debugInfo.map((msg, index) => (
              <div key={index} className="font-mono">{msg}</div>
            ))}
          </div>
        </section>
      )}

      {/* System Status */}
      {process.env.NODE_ENV === 'development' && (
        <section className="bg-gray-100 p-4 rounded text-sm max-w-md">
          <h3 className="font-bold">System Status</h3>
          <p>ESP32 IP: {espIp}</p>
          <p>Connected: {isConnected ? 'Yes' : 'No'}</p>
          <p>Temperature: {temperature}°C</p>
          <p>Humidity: {humidity}%</p>
          <p>Air Quality: {mq135} ppm</p>
          <p>pH: {ph}</p>
          <p>Distance: {distance} cm</p>
          <hr className="my-2" />
          <p>Fan: {fan ? 'ON' : 'OFF'}</p>
          <p>Pump 1: {pump1 ? 'ON' : 'OFF'}</p>
          <p>Pump 2: {pump2 ? 'ON' : 'OFF'}</p>
          <p>LED: {led ? 'ON' : 'OFF'}</p>
          <p>Stepper: {stepperEnabled ? 'ENABLED' : 'DISABLED'}</p>
          <p>Stepper Auto: {stepperAuto ? 'ON' : 'OFF'}</p>
          <p>Stepper Position: {stepperPosition}</p>
          <p className="text-xs text-gray-500">Note: ESP32 uses inverted logic (0=ON, 1=OFF)</p>
          {lastUpdate && (
            <p>Last Update: {lastUpdate.toLocaleString()}</p>
          )}
        </section>
      )}
    </div>
  );
};

export default Dashboard;