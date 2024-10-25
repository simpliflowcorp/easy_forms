"use client";
import axios from "axios";
import * as React from "react";

export interface IformsProps {}

export default function forms(props: IformsProps) {
  // const testModel = async () => {
  //   let res = await axios.post("/api/testDb", { test: "T1" });
  //   console.log(res);
  // };
  // React.useEffect(() => {
  //   testModel();
  // });

  return (
    <div>
      <p>forms</p>
      <div className="header">
        <div className="forms">
          <div className="forms-img"></div>
        </div>
      </div>
    </div>
  );
}
