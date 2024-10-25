"use client";
import axios from "axios";
import * as React from "react";

export interface IsettingsProps {}

export default function settings(props: IsettingsProps) {
  // const testModel = async () => {
  //   let res = await axios.post("/api/testDb", { test: "T1" });
  //   console.log(res);
  // };
  // React.useEffect(() => {
  //   testModel();
  // });

  return (
    <div>
      <p>settings</p>
      <div className="header">
        <div className="settings">
          <div className="settings-img"></div>
        </div>
      </div>
    </div>
  );
}
