"use client";
import PrimaryActionButton from "@/components/buttons/PrimaryActionButton";
import PrimaryButton from "@/components/buttons/PrimaryButton";
import ToogleSwitch from "@/components/buttons/toogleSwitch";
import EmailInput from "@/components/Inputs/EmailInput";
import PasswordInput from "@/components/Inputs/PasswordInput";
import VerificationCodeModel from "@/components/models/VerificationCodeModel";
import { errorHandler } from "@/helper/errorHandler";
import { successHandler } from "@/helper/successHandler";
import { useLanguageStore } from "@/store/store";
import axios from "axios";
import Email from "next-auth/providers/email";
import { useRouter } from "next/navigation";
import * as React from "react";

export interface IsecurityProps {}

export default function security(props: IsecurityProps) {
  const lang = useLanguageStore((state) => state.language);
  const router = useRouter();

  const [data, setData] = React.useState({
    new_email_address: "",
    new_password: "",
    confirm_password: "",
  });
  const [dataIsValid, setDataIsValid] = React.useState({
    new_email_address: false,
    new_password: false,
    confirm_password: false,
  });
  const [resetBtn, setResetBtn] = React.useState(0);

  const forgotPassword = async () => {
    if (
      dataIsValid.new_email_address &&
      dataIsValid.new_password &&
      dataIsValid.confirm_password
    ) {
      try {
        const res = await axios.post("/api/auth/changePassword", data);
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
                label={lang.new_email_address}
                value={data.new_email_address}
                updateValue={(value) =>
                  setData({ ...data, new_email_address: value })
                }
                isRequired={true}
                isValid={dataIsValid.new_email_address}
                updateIsValid={(value) =>
                  setDataIsValid((p) => ({ ...p, new_email_address: value }))
                }
              />
              <div className="btn-cnt">
                <PrimaryActionButton
                  label="change_email_address"
                  action={() => {}}
                  resetBtn={resetBtn}
                />
              </div>
              <VerificationCodeModel
                action={() => {}}
                label="verification_code"
                value={data.new_password}
                updateValue={(value) =>
                  setData({ ...data, new_password: value })
                }
                updateIsValid={(value) =>
                  setDataIsValid((p) => ({ ...p, new_password: value }))
                }
                isValid={dataIsValid.new_password}
                isRequired={true}
                reset={resetBtn}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
