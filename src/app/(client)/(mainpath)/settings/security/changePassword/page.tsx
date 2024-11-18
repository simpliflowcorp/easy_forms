"use client";
import PrimaryActionButton from "@/components/buttons/PrimaryActionButton";
import PrimaryButton from "@/components/buttons/PrimaryButton";
import ToogleSwitch from "@/components/buttons/toogleSwitch";
import PasswordInput from "@/components/Inputs/PasswordInput";
import { useLanguageStore } from "@/store/store";
import axios from "axios";
import { useRouter } from "next/navigation";
import * as React from "react";

export interface IsecurityProps {}

export default function security(props: IsecurityProps) {
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
          <span className="sub-setting-header">{lang.change_password}</span>
          <div className="sub-setting-body">
            <PasswordInput
              reset={1}
              label={lang.password}
              value={""}
              updateValue={(value) => setData({ ...data, password: value })}
              isRequired={true}
              isValid={dataIsValid.password}
              updateIsValid={(value) =>
                setDataIsValid((p) => ({ ...p, password: value }))
              }
            />

            <PasswordInput
              reset={resetBtn}
              label={lang.password}
              value={data.password}
              updateValue={(value) => setData({ ...data, password: value })}
              isRequired={true}
              isValid={dataIsValid.password}
              updateIsValid={(value) =>
                setDataIsValid((p) => ({ ...p, password: value }))
              }
            />

            <PasswordInput
              reset={resetBtn}
              label={lang.password}
              value={data.password}
              updateValue={(value) => setData({ ...data, password: value })}
              isRequired={true}
              isValid={dataIsValid.password}
              updateIsValid={(value) =>
                setDataIsValid((p) => ({ ...p, password: value }))
              }
            />
          </div>
        </div>
      </div>
    </div>
  );
}
