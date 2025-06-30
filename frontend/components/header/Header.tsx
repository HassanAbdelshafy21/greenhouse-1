import React from "react";
import UserMenu from "@/components/userMenu/userMenu";

function Header() {
  return (
    <div className="bg-custom-background flex justify-between items-center p-2  text-custom-text">
      <div className="flex flex-col">
        <h1 className="text-2xl font-bold">Green House</h1>
        <p className="text-sm">Control Your System Remotely</p>
      </div>
      <div className="flex gap-2">
        <UserMenu imgSrc="https://github.com/shadcn.png" imgFallback="SC" />
      </div>
    </div>
  );
}

export default Header;