"use client";
import InfoCard from "@/components/dashboard/cards/InfoCard";
import PieChartComp from "@/components/dashboard/charts/PieChartComp";
import RadarChartComp from "@/components/dashboard/charts/RadarChartComp";
import { useLanguageStore } from "@/store/store";
import axios from "axios";
import { useRouter } from "next/navigation";
import * as React from "react";

export interface IdashboardProps {}

export default function dashboard(props: IdashboardProps) {
  const lang = useLanguageStore((state) => state.language);
  const router = useRouter();

  // const testModel = async () => {
  //   let res = await axios.post("/api/testDb", { test: "T1" });
  //   console.log(res);
  // };
  // React.useEffect(() => {
  //   testModel();
  // });

  return (
    <div className="dashboard-cnt">
      <div className="dashboard-header">
        <span className="header-indicator">/</span>
        <span className="header-text">{lang.dashboard}</span>
      </div>
      <div className="dashboard">
        <div className="card-cnt">
          <InfoCard label={lang.active_forms} count={1} />
          <InfoCard label={lang.total_forms} count={1} />
          <InfoCard label={lang.total_responses} count={10} />
          <InfoCard label={lang.total_visitors} count={30} />
        </div>
        <PieChartComp />
        <RadarChartComp />
      </div>
    </div>
  );
}
