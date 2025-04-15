"use client";
import PrimaryActionButton from "@/components/buttons/PrimaryActionButton";
import PrimaryButton from "@/components/buttons/PrimaryButton";
import ToogleSwitch from "@/components/buttons/toogleSwitch";
import { errorHandler } from "@/helper/errorHandler";
import { successHandler } from "@/helper/successHandler";
import { useLanguageStore } from "@/store/store";
import axios from "axios";
import { useRouter } from "next/navigation";
import { title } from "process";
import * as React from "react";

export interface InotificationProps {}

export default function notification(props: InotificationProps) {
  const lang = useLanguageStore((state) => state.language);
  const router = useRouter();

  React.useEffect(() => {
    getData();
  }, []);

  const [gotData, setGotData] = React.useState(false as boolean);
  const [data, setData] = React.useState([] as any);
  const [resetBtn, setResetBtn] = React.useState(0);
  const [reset, setReset] = React.useState(0);
  const getData = async () => {
    try {
      let res = await axios.get("/api/settings/notification");
      setData(res.data.data);
      setGotData(true);
    } catch (error) {
      errorHandler(error, lang);
    }
  };

  const updateNotification = async () => {
    try {
      const res = await axios.post("/api/settings/notification", data);
      successHandler(res, lang);
      setResetBtn((prev) => prev + 1);
    } catch (error) {
      errorHandler(error, lang);
    }
  };

  const metaData = [
    {
      title: "popup_notification",
      value: "popup",
      options: [
        {
          label: "form_expired_notification",
          value: "formExpired",
        },
      ],
    },
    {
      title: "email_notification",
      value: "email",
      options: [
        {
          label: "form_expired_notification",
          value: "formExpired",
        },
        {
          label: "email_expired_form_data",
          value: "responseSummary",
        },
      ],
    },
  ];

  if (!gotData) {
    return <div className="accent-line-loader"></div>;
  } else
    return (
      <div className="setting-cnt">
        <div className="setting-header">
          <div className="left">
            <span className="header-indicator">/</span>
            <span className="header-text">{lang.notification}</span>
          </div>
          <div className="right">
            <PrimaryActionButton
              resetBtn={resetBtn}
              action={() => {
                updateNotification();
              }}
              label={"update"}
            />
          </div>
        </div>
        <div className="setting-body">
          {metaData.map((item, index) => {
            return (
              <div key={index} className="sub-setting">
                <span className="sub-setting-header">{lang[item.title]}</span>
                <div className="sub-setting-body">
                  {item.options.map((option, index) => {
                    return (
                      <ToogleSwitch
                        key={"op" + index}
                        label={option.label}
                        action={() => {
                          setData((prev: any) => {
                            prev[item.value][option.value] =
                              !prev[item.value][option.value];
                            return prev;
                          });
                        }}
                        value={data[item.value][option.value]}
                      />
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
}
