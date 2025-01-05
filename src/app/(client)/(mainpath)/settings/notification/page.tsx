"use client";
import PrimaryActionButton from "@/components/buttons/PrimaryActionButton";
import PrimaryButton from "@/components/buttons/PrimaryButton";
import ToogleSwitch from "@/components/buttons/toogleSwitch";
import { useLanguageStore } from "@/store/store";
import axios from "axios";
import { useRouter } from "next/navigation";
import * as React from "react";

export interface InotificationProps {}

export default function notification(props: InotificationProps) {
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
          <span className="header-text">{lang.notification}</span>
        </div>
      </div>
      <div className="setting-body">
        <div className="sub-setting">
          <span className="sub-setting-header">{lang.popup_notification}</span>
          <div className="sub-setting-body">
            <ToogleSwitch label="form_expired_notification" action={() => {}} />
          </div>
        </div>
        <div className="sub-setting">
          <span className="sub-setting-header">{lang.email_notification}</span>
          <div className="sub-setting-body">
            <ToogleSwitch label="form_expired_notification" action={() => {}} />
            <ToogleSwitch label="email_expired_form_data" action={() => {}} />
          </div>
        </div>
      </div>
    </div>
  );
}
