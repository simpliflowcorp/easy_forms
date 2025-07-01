"use client";
import MainHeader from "@/components/header/MainHeader";
import FullPageLoader from "@/components/Loaders/FullPageLoader";
import SidebarMain from "@/components/sidebar/SidebarMain";
import useWebSocket from "@/hooks/useWebSocket";
import useActivityDetector from "@/hooks/useActivityDetector";
import axios from "axios";
import { useRouter, usePathname } from "next/navigation";
import * as React from "react";
import { useSession } from "next-auth/react";
import NotificationHandler from "@/components/handler/NotificationHandler";
import AIbar from "@/components/ActionBar/AIbar";

export default function AppLayout({
  children,
  header,
}: Readonly<{
  children: React.ReactNode;
  header: React.ReactNode;
}>) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = React.useState<{ id?: string } | null>(null);
  const [isActive, setIsActive] = React.useState("");
  const [gotData, setGotData] = React.useState(false);

  const { data: session, status } = useSession();
  const [userData, setUserData] = React.useState<any>(null);

  const getUserData = React.useCallback(async () => {
    try {
      const res = await axios.get("/api/user/getUser");
      setUser(res.data.data);
      setGotData(true);
    } catch (error) {
      console.error(error);
      router.push("/login");
    }
  }, []);

  React.useEffect(() => {
    const pathSegment = window.location.pathname.split("/")[1];
    setIsActive(pathSegment);
    getUserData();
  }, [pathname]);

  if (!gotData) return <FullPageLoader />;

  return (
    <>
      <SidebarMain isActive={isActive} data={{}} />

      <div id="select-popup-target" className="select-popup-target"></div>
      <div className="app-cnt">
        <div className="app-wrapper">{children}</div>
        <AIbar />
      </div>
      {user?.id && <NotificationHandler userId={user.id} />}
    </>
  );
}
