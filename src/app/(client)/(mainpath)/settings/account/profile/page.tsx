"use client";
import PrimaryActionButton from "@/components/buttons/PrimaryActionButton";
import PrimaryButton from "@/components/buttons/PrimaryButton";
import ToogleSwitch from "@/components/buttons/toogleSwitch";
import PasswordInput from "@/components/Inputs/PasswordInput";
import TextFieldInput from "@/components/Inputs/TextFieldInput";
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
    first_name: "",
    last_name: "",
    dob: "",
    phone_number: "",
    address: "",
    city: "",
    state: "",
    country: "",
    zip_code: "",
    about: "",
    profile_image: "",
    website: "",
  });
  const [dataIsValid, setDataIsValid] = React.useState({
    first_name: false,
    last_name: false,
    dob: false,
    phone_number: false,
    address: false,
    city: false,
    state: false,
    country: false,
    zip_code: false,
    about: false,
    profile_image: false,
    website: false,
  });
  const [resetBtn, setResetBtn] = React.useState(0);

  const forgotPassword = async () => {
    if (dataIsValid.first_name) {
      try {
        const res = await axios.post("/api/auth/updateProfile", data);
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
          <span className="header-text">{lang.account}</span>
        </div>
      </div>
      <div className="setting-body">
        <div className="sub-setting">
          <span className="sub-setting-header">
            <span
              onClick={() => router.push("/settings/account")}
              className="ic-caret-left sub-setting-line-icon"
            ></span>
            {lang.profile}
          </span>
          <div className="sub-setting-body">
            <div className="sub-setting-body-profile-cnt">
              <TextFieldInput
                reset={resetBtn}
                label={lang.first_name}
                value={data.first_name}
                updateValue={(value: string) =>
                  setData({ ...data, first_name: value })
                }
                isRequired={true}
                isValid={dataIsValid.first_name}
                updateIsValid={(value: boolean) =>
                  setDataIsValid((p) => ({ ...p, username: value }))
                }
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
