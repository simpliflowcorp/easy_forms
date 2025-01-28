"use client";
import MainHeader from "@/components/header/MainHeader";
import FullPageLoader from "@/components/Loaders/FullPageLoader";
import SidebarMain from "@/components/sidebar/SidebarMain";

import axios from "axios";
import { useRouter, usePathname } from "next/navigation";
import * as React from "react";

export default function AppLayout({
  children,
  header,
}: Readonly<{
  children: React.ReactNode;
  header: React.ReactNode;
}>) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = React.useState({} as any);
  const [isActive, setIsActive] = React.useState("" as string);

  const [gotData, setGotData] = React.useState(false);

  const getUserData = async () => {
    try {
      let res = await axios.get("/api/user/getUser");
      setUser(res.data.data);
      setGotData(true);
    } catch (error) {
      console.error(error);
    }
  };

  React.useEffect(() => {
    let path = window.location.pathname.split("/")[1];
    setIsActive(path);
    getUserData();
  }, [pathname]);

  if (!gotData) return <FullPageLoader />;
  else
    return (
      <>
        {/* <MainHeader data={user} /> */}
        <SidebarMain isActive={isActive} data={{}} />
        <div id="select-popup-target" className="select-popup-target"></div>
        <div className="app-wrapper">{children}</div>
      </>
    );
}
