"use client";
import PrimaryActionButton from "@/components/buttons/PrimaryActionButton";
import PrimaryButton from "@/components/buttons/PrimaryButton";
import { useLanguageStore } from "@/store/store";
import axios from "axios";
import exp from "constants";
import { useRouter } from "next/navigation";
import * as React from "react";
import META_DATAS from "@/metaData/fieldTypes.json";
export interface IformsProps {}

export default function forms(props: IformsProps) {
  const lang = useLanguageStore((state) => state.language);
  const router = useRouter();

  const [isActive, setIsActive] = React.useState("all" as string);
  const [gotData, setGotData] = React.useState(false);
  const [data, setData] = React.useState({} as any);

  const [components, setComponents] = React.useState([] as any);

  React.useEffect(() => {
    console.log(META_DATAS);
  }, []);

  return (
    <div className="form-cnt">
      <div className="form-header">
        <div className="left">
          <span className="header-indicator">/</span>
          <span className="header-text">{lang.create_form}</span>
        </div>

        <div className="right">
          <PrimaryButton
            label={"save"}
            action={() => router.push("/forms/create")}
          />
        </div>
      </div>
      <div className="form-sec-cnt">
        <div className="form-sec">
          <div className="components-sec-cnt">
            <div className="components-sec">
              <div className="components-sec-header">
                <span className="header-indicator"></span>
                <span className="header-text">{lang.base_components}</span>
              </div>
              <div className="components-sec-body">
                <div className="components-sec-list">
                  {META_DATAS.map((data: any) => {
                    return (
                      <div className="components-sec-list-item">
                        <span>{lang[data.label]}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
          <div className="form-workbench">
            <div className="workbench-cnt">
              <div className="workbench"></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
