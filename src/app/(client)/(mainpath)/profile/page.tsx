"use client";
import axios from "axios";
import * as React from "react";

export interface IprofileProps {}

export default function profile(props: IprofileProps) {
  // const testModel = async () => {
  //   let res = await axios.post("/api/testDb", { test: "T1" });

  // };
  // React.useEffect(() => {
  //   testModel();
  // });

  return (
    <div>
      <p>profile</p>
      <div className="header">
        <div className="profile">
          <div className="profile-img"></div>
        </div>
      </div>
    </div>
  );
}
