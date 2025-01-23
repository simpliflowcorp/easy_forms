"use client";
import InfoCard from "@/components/dashboard/cards/InfoCard";
import { ChartComponetManger } from "@/components/dashboard/charts/ChartComponetManger";
import PieChartComp from "@/components/dashboard/charts/PieChartComp";
import RadarChartComp from "@/components/dashboard/charts/RadarChartComp";
import { useLanguageStore } from "@/store/store";
import axios from "axios";
import { timeStamp } from "console";
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

  const metaData = {
    name: "SIGN UP FORM",
    description:
      "This is a sign up form. Used to collect user data for the upcoming event. The form includes fields for first name, last name, email, phone, and address. Each field is required to ensure we gather all necessary information from the users. The form is divided into two columns for better organization and readability. The form will expire in two days from now, and its current status is active. Users can fill out the form to register for the event, and the collected data will be used for event planning and communication purposes.",
    expriy: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
    status: 1,
    elements: [
      {
        id: 1,
        label: "First Name",
        type: 1,
        required: 1,
        unique: 0,
        column: 1,
        position: 1,
      },
      {
        id: 2,
        label: "Last Name",
        type: 1,
        required: 1,
        unique: 0,
        column: 2,
        position: 1,
      },
      {
        id: 3,
        label: "Email",
        type: 1,
        required: 1,
        unique: 0,
        column: 1,
        position: 2,
      },
      {
        id: 4,
        label: "Phone",
        type: 1,
        required: 1,
        unique: 0,
        column: 2,
        position: 2,
      },
      {
        id: 5,
        label: "Address",
        type: 1,
        required: 1,
        unique: 0,
        column: 1,
        position: 3,
      },
      {
        id: 6,
        label: "Select Option",
        type: 11,
        required: 1,
        unique: 0,
        column: 2,
        position: 3,
        option: [
          { id: 1, label: "Option 1" },
          { id: 2, label: "Option 2" },
          { id: 3, label: "Option 3" },
          { id: 4, label: "Option 4" },
          { id: 5, label: "Option 5" },
        ],
      },
    ],
  };

  const analyticsData = {
    cards: [
      { label: "Total Responses", count: 10 },
      { label: "Total Visitors", count: 30 },
      { label: "Today Responses", count: 3 },
      { label: "Today Visitors", count: 3 },
    ],
    charts: [
      {
        label: "Activity Last Week Days",
        type: "area",
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
        label: "Activity Last Week Days",
        type: "line",
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
        label: "Activity Last Week Days",
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
        label: "Ratio of Responses",
        type: "pie",
        data: [
          { option: "option 1", value: 5 },
          { option: "option 2", value: 2 },
          { option: "option 3", value: 3 },
        ],
        index: "option",
      },

      {
        label: "Responses Recorded By Forms",
        type: "radar",
        data: [
          { option: "option 1", value: 5 },
          { option: "option 2", value: 2 },
          { option: "option 3", value: 3 },
        ],
        index: "option",
      },
      // {
      //   label: "Responses Recorded By Forms",
      //   type: "line",
      //   data: [
      //     { name: "Form A", value: 6 },
      //     { name: "Form B", value: 1 },
      //     { name: "Form C", value: 3 },
      //   ],
      // },
      // {
      //   label: "Responses Recorded By Forms",
      //   type: "area",
      //   data: [
      //     { name: "Form A", value: 6 },
      //     { name: "Form B", value: 1 },
      //     { name: "Form C", value: 3 },
      //   ],
      // },
    ],
  };

  return (
    <div className="dashboard-cnt">
      <div className="dashboard-header">
        <span className="header-indicator">/</span>
        <span className="header-text">{metaData.name + lang.sanalytics}</span>
      </div>
      <div className="dashboard">
        <div className="cards-cnt">
          {analyticsData.cards.map((card) => (
            <InfoCard label={card.label} count={card.count} />
          ))}
        </div>
        <div className="charts-cnt">
          {analyticsData.charts.map((chart) => (
            <ChartComponetManger
              label={chart.label}
              type={chart.type}
              data={chart.data}
              index={chart.index}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
