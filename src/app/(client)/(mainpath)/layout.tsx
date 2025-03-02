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

  // Activity detector
  // useActivityDetector(() => {
  //   if (user?.id) {
  //     fetch("/api/notifications/pending");
  //   }
  // });

  const getUserData = React.useCallback(async () => {
    try {
      const res = await axios.get("/api/user/getUser");
      setUser(res.data.data);
      setGotData(true);
    } catch (error) {
      console.error(error);
      router.push("/login");
    }
  }, [router]);

  React.useEffect(() => {
    const pathSegment = window.location.pathname.split("/")[1];
    setIsActive(pathSegment);
    getUserData();
  }, [getUserData]);

  // Fetch user data only once
  React.useEffect(() => {
    const fetchUserData = async () => {
      try {
        const res = await fetch("/api/user/me");
        const data = await res.json();
        setUserData(data);
      } catch (error) {
        router.push("/login");
      }
    };

    if (status === "authenticated") {
      fetchUserData();
    }
  }, [status, router]);

  // WebSocket message handler
  // Connect WebSocket only when userId exists
  // useWebSocket(user?.id);
  // In your client component
  const wsRef = React.useRef<WebSocket | null>(null);

  React.useEffect(() => {
    // Connect to separate WebSocket port
    wsRef.current = new WebSocket("ws://localhost:3001");

    wsRef.current.onopen = () => {
      console.log("WebSocket connected");
      wsRef.current?.send("Authentication token here");
    };

    wsRef.current.onmessage = (event) => {
      console.log("Message:", event.data);
    };

    return () => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.close();
      }
    };
  }, []);

  if (!gotData) return <FullPageLoader />;

  return (
    <>
      <SidebarMain isActive={isActive} data={{}} />
      <div id="select-popup-target" className="select-popup-target"></div>
      <div className="app-wrapper">{children}</div>
    </>
  );
}
