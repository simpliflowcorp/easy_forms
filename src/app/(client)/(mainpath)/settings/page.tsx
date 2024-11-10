"use client";
import PrimaryActionButton from "@/components/buttons/PrimaryActionButton";
import PrimaryButton from "@/components/buttons/PrimaryButton";
import { useLanguageStore } from "@/store/store";
import axios from "axios";
import { useRouter } from "next/navigation";
import * as React from "react";

export interface IsettingdProps {}

export default function settings(props: IsettingsProps) {
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
    <div className="settings-cnt">
      <div className="settings-header">
        <div className="left">
          <span className="header-indicator">/</span>
          <span className="header-text">{lang.settings}</span>
        </div>
      </div>
      <div className="settings">
        <div className="settings-cards">
          <div
            className="account card-cnt"
            onClick={() => {
              router.push("/settings/profile");
            }}
          >
            <div className="card">
              <div className="card-text">Account & Preferences</div>
              <div className="card-icon">
                <span className="ic-person"></span>
              </div>
            </div>
          </div>
          <div
            className="security card-cnt"
            onClick={() => {
              router.push("/settings/security");
            }}
          >
            <div className="card">
              <div className="card-text">Sign in & Security</div>
              <div className="card-icon">
                <span className="ic-shield-lock"></span>
              </div>
            </div>
          </div>
          <div
            className="notification card-cnt"
            onClick={() => {
              router.push("/settings/notification");
            }}
          >
            <div className="card">
              <div className="card-text">Notification</div>
              <div className="card-icon">
                <span className="ic-bell"></span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
