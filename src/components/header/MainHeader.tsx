"use client";

import React, { useEffect } from "react";
import PrimaryButton from "../buttons/PrimaryButton";
import { useLanguageStore } from "@/store/store";
import axios from "axios";
import { useRouter } from "next/navigation";
import { signOut, useSession } from "next-auth/react";

type Props = {
  data: any;
};

const MainHeader = (props: Props) => {
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

  return (
    <div className="main-header">
      <div className="company-sec">
        <h1>{lang.company_name}</h1>
      </div>
      <div className="header-sec">
        <div className="header-img"></div>
        <div className="header-name">{props.data.username}</div>
        <PrimaryButton label="logout" action={onLogout} />
      </div>
    </div>
  );
};

export default MainHeader;
