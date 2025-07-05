import { useRef, useEffect, useState } from "react"; // add if not already
import { Camera } from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const CameraFeed = () => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [isOnline, setIsOnline] = useState(true);
  const [currentTime, setCurrentTime] = useState("");

  const [mounted, setMounted] = useState(false);
    useEffect(() => {
    // Only update time on the client
    setCurrentTime(new Date().toLocaleTimeString());
    const interval = setInterval(() => {
      setCurrentTime(new Date().toLocaleTimeString());
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const handleVideoError = () => {
    setIsOnline(false);
  };

  const handleVideoLoaded = () => {
    setIsOnline(true);
  };

  return (
    <Card className="w-full lg:w-1/2 p-6 flex flex-col justify-between">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Camera /> Plant Camera Feed
        </CardTitle>
        <CardDescription>Here you can see the plant growing</CardDescription>
      </CardHeader>
      <CardContent className="aspect-video bg-gray-900 rounded-lg flex items-center justify-center relative overflow-hidden">
        <video
          ref={videoRef}
          src={process.env.NEXT_PUBLIC_PI_STREAM_URL}
          autoPlay
          muted
          playsInline
          onError={handleVideoError}
          onLoadedData={handleVideoLoaded}
          className="w-full h-full object-contain"
        />
        <div className="absolute top-4 left-4">
          <Badge variant="secondary" className={isOnline ? "bg-red-500 text-white" : "bg-gray-500 text-white"}>
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
