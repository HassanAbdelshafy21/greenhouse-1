import React from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "../ui/card";
import { Camera } from "lucide-react";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";

interface ActuatorControlCardProps {
    actuatorIcon: React.ReactNode;
    actuatorName: string;
    status: boolean;
    onToggle?: () => void;
}

const ActuatorControlCard = (props: ActuatorControlCardProps) => {
  return (
    <Card className="w-60 h-fit">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {props.actuatorIcon} {props.actuatorName}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex justify-between">
        <span>Status:</span>
        <Badge className={`${props.status ? "bg-green-500 text-white" : "bg-red-500 text-white"}`}>{props.status ? "ON" : "OFF"}</Badge>
      </CardContent>
      <CardFooter>
        <Button className={`${props.status  ? "bg-red-500 text-white" : "bg-green-500 text-white"} cursor-pointer w-full`} onClick={props.onToggle}>{props.status ? "Turn Off" : "Turn On"}</Button>
      </CardFooter>
    </Card>
  );
};

export default ActuatorControlCard;
