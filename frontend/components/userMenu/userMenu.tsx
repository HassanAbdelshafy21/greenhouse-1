"use client";
import React from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { authClient } from "@/lib/authClient";
import { useRouter } from "next/navigation";

interface UserMenuProps {
  imgSrc: string;
  imgFallback: string;
}

function UserMenu(props: UserMenuProps) {
  const router = useRouter();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="cursor-pointer">
        <Avatar>
          <AvatarImage src={props.imgSrc} />
          <AvatarFallback>{props.imgFallback}</AvatarFallback>
        </Avatar>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuLabel>My Account</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <div className="flex flex-col gap-2">
          

          <DropdownMenuItem
            className="cursor-pointer bg-red-700 text-white "
            onClick={async () => {
              await authClient.signOut();
              router.refresh();
            }}
          >
            Log Out
          </DropdownMenuItem>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default UserMenu;