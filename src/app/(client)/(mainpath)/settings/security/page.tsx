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
  //   console.log(res);
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
          <span className="header-text">{lang.security}</span>
        </div>
      </div>
      <div className="setting-body">
        <div className="sub-setting">
          <span className="sub-setting-header">{lang.account_data}</span>
          <div className="sub-setting-body">
            <div
              onClick={() => router.push("/settings/security/change-password")}
              className="sub-setting-line"
            >
              <span>{lang.change_password}</span>
              <span className="ic-arrow-right-short sub-setting-line-icon"></span>
            </div>
            <div
              onClick={() => router.push("/settings/security/change-email")}
              className="sub-setting-line"
            >
              <span>{lang.change_email_address}</span>
              <span className="ic-arrow-right-short sub-setting-line-icon"></span>
            </div>
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
