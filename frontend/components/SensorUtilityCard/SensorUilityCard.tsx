import React from "react";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "../ui/card";
import { Badge } from "../ui/badge";

interface Props {
  icon: any;
  label: string;
  data: string;
  status: string;
  hint?: string; // Optional hint for additional information
}

const SensorUilityCard = (props: Props) => {
  return (
    <Card className="">
      <CardHeader>
        <CardTitle className="flex gap-4 items-center">
          {props.icon} {props.label}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col  gap-2">
        <span className="font-bold text-2xl text-emerald-600">
          {props.data}
        </span>
        <p>{props.hint}</p>
      </CardContent>
      <CardFooter>
        <Badge variant="secondary" className="bg-red-500 text-white">
          {props.status}
        </Badge>
      </CardFooter>
    </Card>
  );
};

export default SensorUilityCard;
