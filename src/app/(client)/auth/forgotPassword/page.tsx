"use client";
import PrimaryActionButton from "@/components/buttons/PrimaryActionButton";
import EmailInput from "@/components/Inputs/EmailInput";
import { errorHandler } from "@/helper/errorHandler";
import { successHandler } from "@/helper/successHandler";
import { useLanguageStore } from "@/store/store";
import axios from "axios";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";

type Props = {};

export default function ForgotPassword() {
  const lang = useLanguageStore((state) => state.language);
  const router = useRouter();

  const [data, setData] = React.useState({
    email: "",
  });
  const [dataIsValid, setDataIsValid] = React.useState({
    email: false,
  });
  const [resetBtn, setResetBtn] = React.useState(0);

  const forgotPassword = async () => {
    if (dataIsValid.email) {
      try {
        const res = await axios.post("/api/auth/forgotPassword", data);
        successHandler(res, lang);
        router.push("/auth/signin");
      } catch (error: any) {
        setResetBtn((p) => p + 1);
        errorHandler(error, lang);
      }
    } else {
      setResetBtn((p) => p + 1);
    }
  };

  return (
    <div className="auth-wrapper">
      <div className="forgot-password">
        <div className="sec-cnt">
          <h1>Company Logo</h1>
          <div className="container">
            <div className="heading">
              <h1>Reset your password</h1>
              <p>Enter the email address you used to register.</p>
            </div>
            <EmailInput
              reset={resetBtn}
              value={data.email}
              label={lang.email}
              updateValue={(value) => setData((p) => ({ ...p, email: value }))}
              isRequired={true}
              isValid={dataIsValid.email}
              updateIsValid={(value) =>
                setDataIsValid((p) => ({ ...p, email: value }))
              }
            />

            <div className="btn-cnt">
              <div className="link">
                <Link className="link" href="/auth/signin">
                  {lang.back_to_signin}
                </Link>
              </div>
              <PrimaryActionButton
                label="send"
                action={forgotPassword}
                resetBtn={resetBtn}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
