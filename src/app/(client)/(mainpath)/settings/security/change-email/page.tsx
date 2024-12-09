"use client";
import PrimaryActionButton from "@/components/buttons/PrimaryActionButton";
import PrimaryButton from "@/components/buttons/PrimaryButton";
import SecondaryActionButton from "@/components/buttons/SecondaryActionButton";
import SecondaryButton from "@/components/buttons/SecondaryButton";
import ToogleSwitch from "@/components/buttons/toogleSwitch";
import EmailInput from "@/components/Inputs/EmailInput";
import PasswordInput from "@/components/Inputs/PasswordInput";
import VerificationCodeModel from "@/components/models/VerificationCodeModel";
import { errorHandler } from "@/helper/errorHandler";
import { generateVerificationCode } from "@/helper/generateVerificationCode";
import { successHandler } from "@/helper/successHandler";
import { useLanguageStore } from "@/store/store";
import axios from "axios";
import { log } from "console";
import { verify } from "crypto";
import Email from "next-auth/providers/email";
import { useRouter } from "next/navigation";
import * as React from "react";

export interface IsecurityProps {}

export default function security(props: IsecurityProps) {
  const lang = useLanguageStore((state) => state.language);
  const router = useRouter();

  const [data, setData] = React.useState({
    new_email: "",
    verify_code: "",
  });

  const [dataIsValid, setDataIsValid] = React.useState({
    new_email: false,
    verify_code: false,
  });

  const [resetBtn, setResetBtn] = React.useState(0);
  const [resetVerifyBtn, setResetVerifyBtn] = React.useState(0);

  const [modelState, setModelState] = React.useState(false);

  const changeEmail = async () => {
    if (dataIsValid.new_email) {
      try {
        const res = await axios.post("/api/auth/changeEmail", data);
        successHandler(res, lang);
        setResetBtn((p) => p + 1);
        setModelState(true);
      } catch (error: any) {
        setResetBtn((p) => p + 1);
        errorHandler(error, lang);
      }
    } else {
      setResetBtn((p) => p + 1);
    }
  };

  const changeEmailVerify = async () => {
    console.log({ data, dataIsValid });

    if (dataIsValid.verify_code) {
      try {
        const res = await axios.post("/api/auth/changeEmailVerify", data);
        successHandler(res, lang);
        setResetBtn((p) => p + 1);
        setModelState(false);
      } catch (error: any) {
        setResetBtn((p) => p + 1);
        errorHandler(error, lang);
      }
    } else {
      setResetVerifyBtn((p) => p + 1);
    }
  };

  console.log({ resetVerifyBtn });

  return (
    <div className="setting-cnt">
      <div className="setting-header">
        <div className="left">
          <span className="header-indicator">/</span>
          <span className="header-text">{lang.security}</span>
        </div>
      </div>
      <div className="setting-body">
        <div className="sub-setting">
          <span className="sub-setting-header">
            <span
              onClick={() => router.push("/settings/security")}
              className="ic-caret-left sub-setting-line-icon"
            ></span>
            {lang.change_email_address}
          </span>
          <div className="sub-setting-body">
            <div className="sub-setting-body-password-cnt">
              <EmailInput
                reset={resetBtn}
                label={lang.new_email}
                value={data.new_email}
                updateValue={(value) => setData({ ...data, new_email: value })}
                isRequired={true}
                isValid={dataIsValid.new_email}
                updateIsValid={(value) =>
                  setDataIsValid((p) => ({ ...p, new_email: value }))
                }
              />
              <div className="btn-cnt">
                <PrimaryActionButton
                  label="change_email_address"
                  action={() => changeEmail()}
                  resetBtn={resetBtn}
                />
              </div>
              <div className="btn-cnt">
                <SecondaryButton
                  label="i_got_a_verification_code"
                  action={() => {
                    setModelState(true);
                  }}
                />
              </div>
              {modelState ? (
                <VerificationCodeModel
                  closeAction={() => {
                    setModelState(false);
                  }}
                  action={() => {
                    changeEmailVerify();
                  }}
                  label="verification_code"
                  value={data.verify_code}
                  updateValue={(value) =>
                    setData({ ...data, verify_code: value })
                  }
                  updateIsValid={(value) =>
                    setDataIsValid((p) => ({ ...p, verify_code: value }))
                  }
                  isValid={dataIsValid.verify_code}
                  isRequired={true}
                  reset={resetVerifyBtn}
                />
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
