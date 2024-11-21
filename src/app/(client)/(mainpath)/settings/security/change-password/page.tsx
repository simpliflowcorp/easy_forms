"use client";
import PrimaryActionButton from "@/components/buttons/PrimaryActionButton";
import PrimaryButton from "@/components/buttons/PrimaryButton";
import ToogleSwitch from "@/components/buttons/toogleSwitch";
import PasswordInput from "@/components/Inputs/PasswordInput";
import { errorHandler } from "@/helper/errorHandler";
import { successHandler } from "@/helper/successHandler";
import { useLanguageStore } from "@/store/store";
import axios from "axios";
import { useRouter } from "next/navigation";
import * as React from "react";

export interface IsecurityProps {}

export default function security(props: IsecurityProps) {
  const lang = useLanguageStore((state) => state.language);
  const router = useRouter();

  const [data, setData] = React.useState({
    current_password: "",
    new_password: "",
    confirm_password: "",
  });
  const [dataIsValid, setDataIsValid] = React.useState({
    current_password: false,
    new_password: false,
    confirm_password: false,
  });
  const [resetBtn, setResetBtn] = React.useState(0);

  const forgotPassword = async () => {
    if (
      dataIsValid.current_password &&
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
            {lang.change_password}
          </span>
          <div className="sub-setting-body">
            <div className="sub-setting-body-password-cnt">
              <PasswordInput
                reset={resetBtn}
                label={lang.current_password}
                value={data.current_password}
                updateValue={(value) =>
                  setData({ ...data, current_password: value })
                }
                isRequired={true}
                isValid={dataIsValid.current_password}
                updateIsValid={(value) =>
                  setDataIsValid((p) => ({ ...p, current_password: value }))
                }
              />

              <PasswordInput
                reset={resetBtn}
                label={lang.new_password}
                value={data.new_password}
                updateValue={(value) =>
                  setData({ ...data, new_password: value })
                }
                isRequired={true}
                isValid={dataIsValid.new_password}
                updateIsValid={(value) =>
                  setDataIsValid((p) => ({ ...p, new_password: value }))
                }
              />

              <PasswordInput
                reset={resetBtn}
                label={lang.confirm_password}
                value={data.confirm_password}
                updateValue={(value) =>
                  setData({ ...data, confirm_password: value })
                }
                isRequired={true}
                isValid={dataIsValid.confirm_password}
                updateIsValid={(value) =>
                  setDataIsValid((p) => ({ ...p, confirm_password: value }))
                }
              />
              <div className="btn-cnt">
                <PrimaryActionButton
                  label="change_password"
                  action={() => {}}
                  resetBtn={resetBtn}
                />

                <PrimaryActionButton
                  label="forgot_password"
                  action={() => {}}
                  resetBtn={resetBtn}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
