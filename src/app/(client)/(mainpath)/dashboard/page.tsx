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
  const [data, setData] = React.useState({
    cards: [],
    charts: [],
  });
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
    } catch (error) {
      errorHandler(error, lang);
    }
  };
  const barChartData = {};

  let dataSample = {
    cards: [
      { label: "Active Forms", count: 3 },
      { label: "Total Forms", count: 3 },
      { label: "Total Responses", count: 10 },
      { label: "Total Visitors", count: 30 },
    ],
    charts: [
      {
        label: "Activity Last Three Days",
        type: "bar",
        data: [
          { timeStamp: "1730566926000", visited: 2, responded: 1 },
          { timeStamp: "1730653326000", visited: 4, responded: 4 },
          { timeStamp: "1730739726000", visited: 4, responded: 0 },
          { timeStamp: "1730826126000", visited: 10, responded: 4 },
          { timeStamp: "1730912526000", visited: 3, responded: 0 },
          { timeStamp: "1730998926000", visited: 7, responded: 1 },
        ],
        index: "timeStamp",
      },
      {
        label: "Visited Forms Last Three Days",
        type: "pie",
        data: [
          { name: "Form A", value: 15 },
          { name: "Form B", value: 6 },
          { name: "Form C", value: 9 },
        ],
        index: "name",
      },
      {
        label: "Responses Recorded By Forms",
        type: "radar",
        data: [
          { name: "Form A", value: 6 },
          { name: "Form B", value: 1 },
          { name: "Form C", value: 3 },
        ],
        index: "name",
      },
    ],
  };

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
            {data.cards.map((card, index) => (
              <InfoCard key={index} label={card?.label} count={card?.count} />
            ))}
          </div>

          <div className="charts-cnt">
            {data.charts.map((chart, index) => {
              return (
                <ChartComponetManger
                  label={chart.label}
                  type={chart.type}
                  data={chart.data}
                  index={chart.index}
                />
              );
            })}
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
