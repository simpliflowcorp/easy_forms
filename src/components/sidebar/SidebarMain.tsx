"use client";

import React, { useEffect } from "react";
import PrimaryButton from "../buttons/PrimaryButton";
import { useLanguageStore } from "@/store/store";
import axios from "axios";
import { useRouter } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import Image from "next/image";
import IconButton from "../buttons/IconButton";

type Props = {
  isActive: string;
  data: any;
};

const SidebarMain = (props: Props) => {
  const lang = useLanguageStore((state) => state.language);
  const [user, setUser] = React.useState({} as any);
  const [gotData, setGotData] = React.useState(false);
  const router = useRouter();
  const session = useSession();

  console.log(session);

  const onLogout = async () => {
    try {
      signOut();
      await axios.get("/api/auth/logout");
      router.push("/auth/signin");
    } catch (error) {
      console.error(error);
    }
  };

  const routerSwitch = (path: string) => {
    router.push(path);
  };

  return (
    <div className="sidebar-main">
      <div className="header-sec">
        <div className="header-img">
          <Image
            src="/logos/logo_dark_fillet_750.png"
            alt="logo"
            width={40}
            height={40}
            className="logo"
            priority
          />
        </div>
        <div className="control-pannel">
          <div
            className={
              props.isActive === "dashboard" ? "control active" : "control"
            }
          >
            <IconButton
              icon="columns-gap"
              action={() => {
                routerSwitch("/dashboard");
              }}
            />
          </div>
          <div
            className={
              props.isActive === "forms" ? "control active" : "control"
            }
          >
            <IconButton
              icon="journal-text"
              action={() => {
                routerSwitch("/forms");
              }}
            />
          </div>
          <div
            className={
              props.isActive === "settings" ? "control active" : "control"
            }
          >
            <IconButton
              icon="gear"
              action={() => {
                routerSwitch("/settings");
              }}
            />
          </div>
        </div>
      </div>
      <div className="footer-sec">
        <IconButton icon="box-arrow-left" action={onLogout} />
      </div>
    </div>
  );
};

export default SidebarMain;
