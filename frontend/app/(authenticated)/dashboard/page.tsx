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
} from "lucide-react";
import React, { useState } from "react";
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
import SensorUilityCard from "@/components/SensorUtilityCard/SensorUilityCard";
import ActuatorControlCard from "@/components/actuatorControlCard/ActuatorControlCard";
import { Separator } from "@/components/ui/separator";
import Header from "@/components/header/Header";

const Dashboard = () => {
  const [fan1, setFan1] = useState(false);
  const [fan2, setFan2] = useState(false);
  const [led, setLed] = useState(false);
  const [motor, setMotor] = useState(false);
  const [pump1, setPump1] = useState(false);
  const [pump2, setPump2] = useState(false);

  return (
    <div className="min-h-screen w-full flex flex-col gap-8 items-center  bg-gradient-to-br from-green-50 to-emerald-100 pb-4">
      {/* Header */}
      <div className="w-full px-6">
        <Header />
        <Separator className="my-2 h-[20px]" />
      </div>

      {/* Hero Section */}
      <section className="flex flex-col items-center gap-2 text-center">
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <Leaf className="w-10 h-10" />
          Greenhouse Control Center
        </h1>
        <p>Monitor and control your greenhouse environment</p>
      </section>

      {/* Utilities */}
      <section className="flex items-center gap-4 flex-wrap justify-center">
        <SensorUilityCard
          icon={<Thermometer />}
          label="Temperature"
          data="24.5°C"
          status="Normal"
          hint="Optimal range: 20°C - 30°C"
        />
        <SensorUilityCard
          icon={<Droplets />}
          label="Humidity"
          data="45%"
          status="Normal"
          hint="Optimal range: 20% - 60%"
        />
        <SensorUilityCard
          icon={<FlaskConical />}
          label="pH Level"
          data="6.8"
          status="Normal"
          hint="Optimal range: 6.0 - 7.5"
        />

        <SensorUilityCard
          icon={<Gauge />}
          label="Water Level"
          data="32.4 cm"
          status="Normal"
          hint="Optimal range: 20 cm - 40 cm"
        />

        <SensorUilityCard
          icon={<Cloud />}
          label="Gas Sensor"
          data="185 ppm"
          status="Normal"
          hint="Optimal range: 100 - 200 ppm"
        />
      </section>

      {/* Camera Feed */}
      <Card className="w-full lg:w-1/2 p-6 flex flex-col justify-between">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Camera /> Plant Camera Feed
          </CardTitle>
          <CardDescription>Here you can see the plant growing</CardDescription>
        </CardHeader>
        <CardContent className="aspect-video bg-gray-900 rounded-lg flex items-center justify-center relative overflow-hidden">
          <Image
            src="/placeholder.svg"
            alt="camera feed placeholder"
            fill
            className="object-contain"
          />
          <div className="absolute top-4 left-4">
            <Badge variant="secondary" className="bg-red-500 text-white">
              ● LIVE
            </Badge>
          </div>
          <div className="absolute bottom-4 right-4 text-white text-sm bg-black/50 px-2 py-1 rounded">
            {new Date().toLocaleTimeString()}
          </div>
        </CardContent>
      </Card>

      {/* Actuator Controls */}
      <section className="flex flex-wrap gap-4 w-[60%] items-center justify-center">
        <ActuatorControlCard
          actuatorIcon={<Fan />}
          actuatorName="Fan 1"
          status={fan1}
          onToggle={() => {
            setFan1(!fan1)
            console.log(fan1)
          }}
        />
        <ActuatorControlCard
          actuatorIcon={<Fan />}
          actuatorName="Fan 2"
          status={fan2}
          onToggle={() => {
            setFan2(!fan2)
            console.log(fan2)
          }}
        />
        <ActuatorControlCard
          actuatorIcon={<Lightbulb />}
          actuatorName="LED"
          status={led}
          onToggle={() => {
            setLed(!led)
            console.log(led)
          }}
        />
        <ActuatorControlCard
          actuatorIcon={<RotateCcw />}
          actuatorName="Motor"
          status={motor}
          onToggle={() => {
            setMotor(!motor)
            console.log(motor)
          }}
        />
        <ActuatorControlCard
          actuatorIcon={<RotateCcw />}
          actuatorName="Pump 1"
          status={pump1}
          onToggle={() => {
            setPump1(!pump1)
            console.log(pump1)
          }}
        />
        <ActuatorControlCard
          actuatorIcon={<RotateCcw />}
          actuatorName="Pump 2"
          status={pump2}
          onToggle={() => {
            setPump2(!pump2)
            console.log(pump2)
          }}
        />
      </section>
    </div>
  );
};

export default Dashboard;
