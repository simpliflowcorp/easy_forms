"use client";
import PrimaryActionButton from "@/components/buttons/PrimaryActionButton";
import PrimaryButton from "@/components/buttons/PrimaryButton";
import { useLanguageStore } from "@/store/store";
import axios from "axios";
import exp from "constants";
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

  const [isActive, setIsActive] = React.useState("all" as string);

  const [gotData, setGotData] = React.useState(false);

  const [data, setData] = React.useState({} as any);

  const [forms, setForms] = React.useState([
    {
      id: 1,
      name: "form1",
      status: 1,
      expiry: new Date().valueOf() + 24 * 60 * 60 * 1000,
      total_responses: 1,
      today_responses: 1,
    },
    {
      id: 2,
      name: "form2",
      status: 1,
      expiry: new Date().valueOf() + 48 * 60 * 60 * 1000,
      total_responses: 1,
      today_responses: 1,
    },
    {
      id: 3,
      name: "form3",
      status: 1,
      expiry: new Date().valueOf() + 72 * 60 * 60 * 1000,
      total_responses: 3,
      today_responses: 0,
    },
    {
      id: 1,
      name: "form1",
      status: 0,
      expiry: new Date().valueOf() + 24 * 60 * 60 * 1000,
      total_responses: 99,
      today_responses: 0,
    },
    {
      id: 2,
      name: "form2",
      status: 1,
      expiry: new Date().valueOf() + 48 * 60 * 60 * 1000,
      total_responses: 10000,
      today_responses: 1000,
    },
    {
      id: 3,
      name: "form3",
      status: 0,
      expiry: new Date().valueOf() + 72 * 60 * 60 * 1000,
      total_responses: 0,
      today_responses: 0,
    },
  ] as any);

  function countDown(expiringDate: number) {
    const now = Date.now();
    const timeRemaining = expiringDate - now;

    // const days = Math.floor(timeRemaining / (1000 * 60 * 60 * 24));
    // const hours = Math.floor(
    //   (timeRemaining % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)
    // );
    // const minutes = Math.floor(
    //   (timeRemaining % (1000 * 60 * 60)) / (1000 * 60)
    // );
    // const seconds = Math.floor((timeRemaining % (1000 * 60)) / 1000);

    // return `${days}d ${hours}h ${minutes}m ${seconds}s`;

    const totalHours = Math.floor(timeRemaining / (1000 * 60 * 60));
    const minutes = Math.floor(
      (timeRemaining % (1000 * 60 * 60)) / (1000 * 60)
    );
    const seconds = Math.floor((timeRemaining % (1000 * 60)) / 1000);

    return `${totalHours}h ${minutes}m ${seconds}s`;
  }

  return (
    <div className="form-cnt">
      <div className="form-header">
        <div className="left">
          <span className="header-indicator">/</span>
          <span className="header-text">{lang.create_form}</span>
        </div>

        <div className="right">
          <PrimaryButton
            label={"save"}
            action={() => router.push("/forms/create")}
          />
        </div>
      </div>
      <div className="form-sec-cnt">
        <div className="form-sec">
          <div className="components-sec-cnt"></div>
          <div className="form-workbench"></div>
        </div>
      </div>
    </div>
  );
}
