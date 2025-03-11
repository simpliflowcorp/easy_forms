"use client";
import InfoCard from "@/components/dashboard/cards/InfoCard";
import { ChartComponetManger } from "@/components/dashboard/charts/ChartComponetManger";
import PieChartComp from "@/components/dashboard/charts/PieChartComp";
import RadarChartComp from "@/components/dashboard/charts/RadarChartComp";
import { errorHandler } from "@/helper/errorHandler";
import { useLanguageStore } from "@/store/store";
import axios from "axios";
import { useRouter } from "next/navigation";
import * as React from "react";

export interface IdashboardProps {}

export default function dashboard(props: IdashboardProps) {
  const lang = useLanguageStore((state) => state.language);
  const router = useRouter();
  const [data, setData] = React.useState({});
  const [gotData, setGotData] = React.useState(false);

  // const testModel = async () => {
  //   let res = await axios.post("/api/testDb", { test: "T1" });

  // };
  // React.useEffect(() => {
  //   testModel();
  // });

  const getDashboardData = async () => {
    try {
      let res = await axios.get("/api/dashboard");
      setData(res.data.data);
      setGotData(true);
      console.log(res);
    } catch (error) {
      errorHandler(error, lang);
    }
  };
  const barChartData = {};

  React.useEffect(() => {
    getDashboardData();
  }, []);

  if (!gotData) {
    return <div className="accent-line-loader"></div>;
  } else {
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
              data={[
                { timeStamp: "1730566926000", visited: 2, responded: 1 },
                { timeStamp: "1730653326000", visited: 4, responded: 4 },
                { timeStamp: "1730739726000", visited: 4, responded: 0 },
                { timeStamp: "1730826126000", visited: 10, responded: 4 },
                { timeStamp: "1730912526000", visited: 3, responded: 0 },
                { timeStamp: "1730998926000", visited: 7, responded: 1 },
              ]}
              index="timeStamp"
            />

            <ChartComponetManger
              label={lang.visited_forms_last_three_days}
              type="pie"
              data={[
                { name: "Form A", value: 15 },
                { name: "Form B", value: 6 },
                { name: "Form C", value: 9 },
              ]}
              index="name"
            />
            <ChartComponetManger
              label={lang.responses_recorded_by_forms}
              type="radar"
              data={[
                { name: "Form A", value: 6 },
                { name: "Form B", value: 1 },
                { name: "Form C", value: 3 },
              ]}
              index="name"
            />
          </div>
        </div>
      </div>
    );
  }
}
