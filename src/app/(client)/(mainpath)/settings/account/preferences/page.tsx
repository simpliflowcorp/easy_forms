"use client";
import PrimaryActionButton from "@/components/buttons/PrimaryActionButton";
import PrimaryButton from "@/components/buttons/PrimaryButton";
import DynamicFieldManger from "@/components/Inputs/DynamicFieldManger";
import PasswordInput from "@/components/Inputs/PasswordInput";
import SelectFieldInput from "@/components/Inputs/SelectFieldInput";
import TextFieldInput from "@/components/Inputs/TextFieldInput";
import { errorHandler } from "@/helper/errorHandler";
import { successHandler } from "@/helper/successHandler";
import { useLanguageStore } from "@/store/store";
import axios from "axios";
import { useRouter } from "next/navigation";
import * as React from "react";
import countryData from "@/metaData/country.json";

export interface IsecurityProps {}

export default function security(props: IsecurityProps) {
  const lang = useLanguageStore((state) => state.language);
  const router = useRouter();

  const [data, setData] = React.useState({
    language: "",
    date_format: "",
    country: "",
    time_format: "",
  });

  const [dataIsValid, setDataIsValid] = React.useState({
    language: false,
    date_format: false,
    time_format: false,
    country: false,
  });
  const [structureData, setStructureData] = React.useState([
    {
      name: "date_format",
      type: 11,
      options: [
        { label: "dd-mm-yyyy", value: "dd-mm-yyyy" },
        { label: "mm-dd-yyyy", value: "mm-dd-yyyy" },
        { label: "yyyy-mm-dd", value: "yyyy-mm-dd" },
      ],
    },
    {
      name: "language",
      type: 11,
      options: [
        { value: "en", label: "English" },
        { value: "ch", label: "Chinese" },
      ],
    },
    {
      name: "country",
      type: 11,
      options: countryData,
    },
  ]);

  const [resetBtn, setResetBtn] = React.useState(0);
  const [reset, setReset] = React.useState(0);

  const getPreferences = async () => {
    try {
      const res = await axios.get("/api/settings/preferences");
      console.log(res.data.data);

      setData(res.data.data);
    } catch (error: any) {
      errorHandler(error, lang);
    }
  };

  const changeLanguage = (value: string) => {
    // setData({ ...data, language: value });
  };

  React.useEffect(() => {
    getPreferences();
  }, []);

  const updatePreferences = async () => {
    try {
      const res = await axios.post("/api/settings/preferences", data);
      successHandler(res, lang);
      setResetBtn((p) => p + 1);
    } catch (error: any) {
      errorHandler(error, lang);
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
        <div className="right">
          <PrimaryActionButton
            resetBtn={resetBtn}
            label={"update"}
            action={() => updatePreferences()}
          />
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
              {structureData.map((item, index) => (
                <div key={index} className="sub-setting-body-profile-line">
                  <DynamicFieldManger
                    reset={reset}
                    label={lang[item.name]}
                    options={item.options ? item.options : []}
                    // value={data[item.name]}
                    value={data[item.name as keyof typeof data]}
                    updateValue={(value: string) =>
                      setData({ ...data, [item.name]: value })
                    }
                    isRequired={false}
                    // isValid={dataIsValid[item.name]}
                    isValid={dataIsValid[item.name as keyof typeof dataIsValid]}
                    updateIsValid={(value: boolean) =>
                      setDataIsValid((p) => ({ ...p, [item.name]: value }))
                    }
                    type={item.type}
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
