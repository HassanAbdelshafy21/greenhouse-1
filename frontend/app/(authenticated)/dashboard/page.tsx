import { Activity, Camera, Cloud, Droplets, FlaskConical, Gauge, Leaf, Thermometer } from "lucide-react";
import React from "react";
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

const Dashboard = () => {
  return (
    <div className="min-h-screen w-full flex flex-col items-center  bg-gradient-to-br from-green-50 to-emerald-100">
      <section className="flex flex-col items-center gap-2 py-10">
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <Leaf className="w-10 h-10" />
          Greenhouse Control Center
        </h1>
        <p>Monitor and control your greenhouse environment</p>
      </section>

      <div className="flex gap-4 ">
        {/* Placeholder */}
        <Card className="p-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Camera /> Plant Camera Feed
            </CardTitle>
            <CardDescription>
              Here you can see the plant Growing
            </CardDescription>
          </CardHeader>
          <CardContent className="aspect-video bg-gray-900 rounded-lg flex items-center justify-center relative overflow-hidden">
            <Image
              src="./placeholder.svg"
              alt="camera feed placeholder"
              width={600}
              height={400}
              className=" object-contain"
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

        {/* Utilities */}
        <div className="grid grid-cols-2  gap-4">
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
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
