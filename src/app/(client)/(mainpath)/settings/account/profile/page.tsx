"use client";
import PrimaryActionButton from "@/components/buttons/PrimaryActionButton";
import PrimaryButton from "@/components/buttons/PrimaryButton";
import ToogleSwitch from "@/components/buttons/toogleSwitch";
import DynamicFieldManger from "@/components/Inputs/DynamicFieldManger";
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
    firstName: "",
    lastName: "",
    dob: "",
    phoneNumber: "",
    address: "",
    city: "",
    state: "",
    country: "",
    zipCode: "",
    about: "",
    profileImage: "",
    website: "",
  });

  const [dataIsValid, setDataIsValid] = React.useState({
    firstName: false,
    lastName: false,
    dob: false,
    phoneNumber: false,
    address: false,
    city: false,
    state: false,
    country: false,
    zipCode: false,
    about: false,
    profileImage: false,
    website: false,
  });

  const [structureData, setStructureData] = React.useState([
    {
      name: "first_name",
      label: "firstName",
      type: 1,
    },
    {
      name: "last_name",
      label: "lastName",
      type: 1,
    },
    {
      name: "phone_number",
      label: "phoneNumber",
      type: 2,
    },
    {
      name: "address",
      label: "address",
      type: 1,
    },
    {
      name: "city",
      label: "city",
      type: 1,
    },
    {
      name: "state",
      label: "state",
      type: 1,
    },
    {
      name: "country",
      label: "country",
      type: 1,
    },
    {
      name: "zip_code",
      label: "zipCode",
      type: 1,
    },
    {
      name: "website",
      label: "website",
      type: 1,
    },
    {
      name: "dob",
      label: "dob",
      type: 21,
    },
  ]);

  const [resetBtn, setResetBtn] = React.useState(0);
  const [reset, setReset] = React.useState(0);

  const forgotPassword = async () => {
    if (dataIsValid.firstName) {
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

  React.useEffect(() => {
    fetchProfileData();
  }, []);

  const [gotData, setGotData] = React.useState(false);

  const fetchProfileData = async () => {
    try {
      const response = await axios.get("/api/settings/profile");
      if (response.status === 200) {
        setData((prevState) => ({ ...prevState, ...response.data.data }));
        setGotData(true);
      }
    } catch (error) {
      errorHandler(error, lang);
    }
  };

  const updateProfile = async () => {
    try {
      const res = await axios.post("/api/settings/profile", data);
      successHandler(res, lang);
      setResetBtn((p) => p + 1);
    } catch (error: any) {
      setResetBtn((p) => p + 1);
      errorHandler(error, lang);
    }
  };

  if (!gotData) {
    return <div className="accent-line-loader"></div>;
  } else
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
              action={() => updateProfile()}
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
                      // options={item?.options ? item?.options : []}
                      options={item?.options ?? []}
                      reset={reset}
                      label={lang[item.name]}
                      // value={data[item.name]}
                      value={data[item.label as keyof typeof data]}
                      updateValue={(value: string) =>
                        setData({ ...data, [item.label]: value })
                      }
                      isRequired={item.label === "firstName"}
                      // isValid={dataIsValid[item.name]}
                      isValid={
                        dataIsValid[item.label as keyof typeof dataIsValid]
                      }
                      updateIsValid={(value: boolean) =>
                        setDataIsValid((p) => ({ ...p, [item.label]: value }))
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
