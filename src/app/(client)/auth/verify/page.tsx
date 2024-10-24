"use client";
import BigTickLoader from "@/components/Loaders/BigTickLoader";
import BigXCrossLoader from "@/components/Loaders/BigXCrossLoader";
import FullPageLoader from "@/components/Loaders/FullPageLoader";
import { useLanguageStore } from "@/store/store";
import axios from "axios";
import * as React from "react";
import Link from "next/link";

export interface IverifyProps {}

export default function Verify(props: IverifyProps) {
  const [isVerfied, setIsVerfied] = React.useState(false);
  const [gotData, setGotData] = React.useState(false);
  const lang = useLanguageStore((state) => state.language);

  const [errorText, setErrorText] = React.useState("");

  React.useEffect(() => {
    let verifyToken = window.location.search.split("=")[1];

    const verify = async () => {
      try {
        let res = await axios.post("/api/auth/verifyEmail", { verifyToken });
        console.log({ res });
        setGotData(true);
        if (res.status === 200) {
          setIsVerfied(true);
        } else {
        }
      } catch (error: any) {
        console.log(error);
        setGotData(true);
        setErrorText(error.response.data.message as string);
        setIsVerfied(false);
      }
    };
    verify();
  }, []);

  return (
    <div className="verify-card-cnt">
      <div className="card-header">
        <h1>{lang.company_name}</h1>
      </div>
      <div className="verify-card">
        {!gotData ? <h4>{lang.verifing_your_email}</h4> : <></>}
        {gotData && isVerfied ? (
          <h4>{lang.user_successfully_verified}</h4>
        ) : (
          <></>
        )}
        {gotData && !isVerfied ? <h4>{lang[errorText]}</h4> : <></>}
        {!gotData ? <FullPageLoader /> : <></>}
        {gotData && isVerfied ? <BigTickLoader /> : <></>}
        {gotData && !isVerfied ? <BigXCrossLoader /> : <></>}

        <div className="btns">
          <Link className="primary-button" href="/profile">
            <span>{lang.profile}</span>
          </Link>
        </div>
      </div>
    </div>
  );
}
