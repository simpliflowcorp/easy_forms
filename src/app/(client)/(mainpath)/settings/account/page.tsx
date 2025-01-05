"use client";
import PrimaryActionButton from "@/components/buttons/PrimaryActionButton";
import PrimaryButton from "@/components/buttons/PrimaryButton";
import ToogleSwitch from "@/components/buttons/toogleSwitch";
import { useLanguageStore } from "@/store/store";
import axios from "axios";
import { useRouter } from "next/navigation";
import * as React from "react";

export interface IsecurityProps {}

export default function security(props: IsecurityProps) {
  const lang = useLanguageStore((state) => state.language);
  const router = useRouter();

  // const testModel = async () => {
  //   let res = await axios.post("/api/testDb", { test: "T1" });

  // };
  // React.useEffect(() => {
  //   testModel();
  // });

  const barChartData = {};

  return (
    <div className="setting-cnt">
      <div className="setting-header">
        <div className="left">
          <span className="header-indicator">/</span>
          <span className="header-text">{lang.account}</span>
        </div>
      </div>
      <div className="setting-body">
        <div className="sub-setting">
          <span className="sub-setting-header">
            {lang.account_and_preferences}
          </span>
          <div className="sub-setting-body">
            <div
              onClick={() => router.push("/settings/account/profile")}
              className="sub-setting-line"
            >
              <span>{lang.profile}</span>
              <span className="ic-arrow-right-short sub-setting-line-icon"></span>
            </div>
            <div
              onClick={() => router.push("/settings/account/preferences")}
              className="sub-setting-line"
            >
              <span>{lang.preferences}</span>
              <span className="ic-arrow-right-short sub-setting-line-icon"></span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
