import { useEffect, useState } from "react";
import { Camera } from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const CameraFeed = () => {
  const [isOnline, setIsOnline] = useState(true);
  const [currentTime, setCurrentTime] = useState("");

  useEffect(() => {
    setCurrentTime(new Date().toLocaleTimeString());
    const interval = setInterval(() => {
      setCurrentTime(new Date().toLocaleTimeString());
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // Check if the stream is reachable
  useEffect(() => {
    const img = new Image();
    img.src = `${process.env.NEXT_PUBLIC_PI_STREAM_URL}?t=${Date.now()}`;
    img.onload = () => setIsOnline(true);
    img.onerror = () => setIsOnline(false);
  }, []);

  return (
    <Card className="w-full lg:w-1/2 p-6 flex flex-col justify-between">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Camera /> Plant Camera Feed
        </CardTitle>
        <CardDescription>Watch your plant in real-time</CardDescription>
      </CardHeader>
      <CardContent className="aspect-video bg-gray-900 rounded-lg flex items-center justify-center relative overflow-hidden">
        {isOnline ? (
          <img
            src={process.env.NEXT_PUBLIC_PI_STREAM_URL}
            alt="Plant Camera"
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="text-white">Camera Offline</div>
        )}

        <div className="absolute top-4 left-4">
          <Badge
            variant="secondary"
            className={isOnline ? "bg-green-500 text-white" : "bg-gray-500 text-white"}
          >
            ● {isOnline ? "LIVE" : "OFFLINE"}
          </Badge>
        </div>

        <div className="absolute bottom-4 right-4 text-white text-sm bg-black/50 px-2 py-1 rounded">
          {currentTime}
        </div>
      </CardContent>
    </Card>
  );
};

export default CameraFeed;
