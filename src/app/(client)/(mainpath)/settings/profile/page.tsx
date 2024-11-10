"use client";
import PrimaryActionButton from "@/components/buttons/PrimaryActionButton";
import PrimaryButton from "@/components/buttons/PrimaryButton";
import { useLanguageStore } from "@/store/store";
import axios from "axios";
import { useRouter } from "next/navigation";
import * as React from "react";

export interface IprofileProps {}

export default function profile(props: IprofileProps) {
  const lang = useLanguageStore((state) => state.language);
  const router = useRouter();

  // const testModel = async () => {
  //   let res = await axios.post("/api/testDb", { test: "T1" });
  //   console.log(res);
  // };
  // React.useEffect(() => {
  //   testModel();
  // });

  const barChartData = {};

  return (
    <div className="profile-cnt">
      <div className="profile-header">
        <div className="left">
          <span className="header-indicator">/</span>
          <span className="header-text">{lang.profile}</span>
        </div>
      </div>
      <div className="profile"></div>
    </div>
  );
}
