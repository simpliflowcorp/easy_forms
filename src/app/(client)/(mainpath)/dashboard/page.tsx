"use client";
import InfoCard from "@/components/dashboard/cards/InfoCard";
import { ChartComponetManger } from "@/components/dashboard/charts/ChartComponetManger";
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

  // };
  // React.useEffect(() => {
  //   testModel();
  // });

  const barChartData = {};

  return (
    <div className="dashboard-cnt">
      <div className="dashboard-header">
        <span className="header-indicator">/</span>
        <span className="header-text">{lang.dashboard}</span>
      </div>
      <div className="dashboard">
        <div className="cards-cnt">
          <InfoCard label={lang.active_forms} count={3} />
          <InfoCard label={lang.total_forms} count={3} />
          <InfoCard label={lang.total_responses} count={10} />
          <InfoCard label={lang.total_visitors} count={30} />
        </div>

        <div className="charts-cnt">
          <ChartComponetManger
            label={lang.activity_last_three_days}
            type="bar"
            data={{
              "1730566926000": { visited: 15, responded: 3 },
              "1730653326000": { visited: 6, responded: 4 },
              "1730739726000": { visited: 9, responded: 3 },
            }}
          />
          <ChartComponetManger
            label={lang.visited_forms_last_three_days}
            type="pie"
            data={[
              { name: "Form A", value: 15 },
              { name: "Form B", value: 6 },
              { name: "Form C", value: 9 },
            ]}
          />
          <ChartComponetManger
            label={lang.responses_recorded_by_forms}
            type="radar"
            data={[
              { name: "Form A", value: 6 },
              { name: "Form B", value: 1 },
              { name: "Form C", value: 3 },
            ]}
          />
        </div>
      </div>
    </div>
  );
}
