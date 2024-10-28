"use client";
import InfoCard from "@/components/dashboard/cards/InfoCard";
import PieChartComp from "@/components/dashboard/charts/PieChartComp";
import RadarChartComp from "@/components/dashboard/charts/RadarChartComp";
import axios from "axios";
import * as React from "react";

export interface IdashboardProps {}

export default function dashboard(props: IdashboardProps) {
  // const testModel = async () => {
  //   let res = await axios.post("/api/testDb", { test: "T1" });
  //   console.log(res);
  // };
  // React.useEffect(() => {
  //   testModel();
  // });

  return (
    <div>
      <p>dashboard</p>
      <div className="header">
        <div className="dashboard">
          <div className="dashboard-img"></div>
          <PieChartComp />
          <RadarChartComp />
          <InfoCard label="active" count="5" />
        </div>
      </div>
    </div>
  );
}
