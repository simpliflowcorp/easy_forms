"use client";
import PrimaryActionButton from "@/components/buttons/PrimaryActionButton";
import PrimaryButton from "@/components/buttons/PrimaryButton";
import { useLanguageStore } from "@/store/store";
import axios from "axios";
import { useRouter } from "next/navigation";
import * as React from "react";

export interface IformsProps {}

export default function forms(props: IformsProps) {
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
    <div className="forms-cnt">
      <div className="forms-header">
        <div className="left">
          <span className="header-indicator">/</span>
          <span className="header-text">{lang.forms}</span>
        </div>

        <div className="right">
          <PrimaryButton
            label={"create_form"}
            action={() => router.push("/forms/create")}
          />
        </div>
      </div>
      <div className="forms"></div>
    </div>
  );
}
