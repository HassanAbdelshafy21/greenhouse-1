import { Loader } from "lucide-react";

export default function Loading() {
  return (
    <div className="flex h-screen w-full items-center justify-center">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Loader className="animate-spin" />
        <span>Loading...</span>
      </div>
    </div>
  );
}