"use client";
import DynamicElement from "@/components/builderWorkbench/builderComponents/DynamicElement";
import GreenPrimaryActionButton from "@/components/buttons/GreenPrimaryActionButton";
import IconButton from "@/components/buttons/IconButton";
import PrimaryButton from "@/components/buttons/PrimaryButton";
import PromotionButton from "@/components/buttons/PromotionButton";
import RedSecondaryButton from "@/components/buttons/RedSecondaryButton";
import SecondaryButton from "@/components/buttons/SecondaryButton";
import InfoCard from "@/components/dashboard/cards/InfoCard";
import { ChartComponetManger } from "@/components/dashboard/charts/ChartComponetManger";
import PieChartComp from "@/components/dashboard/charts/PieChartComp";
import RadarChartComp from "@/components/dashboard/charts/RadarChartComp";
import { useLanguageStore } from "@/store/store";
import axios from "axios";
import { useRouter } from "next/navigation";
import * as React from "react";

export interface IdashboardProps {}

export default function dashboard(props: IdashboardProps) {
  const lang = useLanguageStore((state) => state.language);
  const router = useRouter();

  const [gotData, setGotData] = React.useState(false);
  const [formData, setFormData] = React.useState({} as any);

  const [formId, setFormID] = React.useState("" as string);

  const getFormData = async () => {
    try {
      const res = await axios.get("/api/form/read");
      if (res.status === 200) {
        setFormData(res.data.data);
        setGotData(true);
      }
    } catch (error: any) {
      console.log(error);
    }
  };

  React.useEffect(() => {
    // how to get form id
    setFormID(window.location.pathname.split("/").pop() + "");
    getFormData();
  }, []);

  if (!gotData) {
    return <div className="accent-line-loader"></div>;
  } else {
    return (
      <div className="form-cnt">
        <div className="form-header">
          <div className="left">
            <div className="form-sec-header-left">
              <span className="header-indicator">/</span>
              <span className="header-text">{formData.name}</span>
            </div>
            <div className="form-sec-header-right">
              <div
                className={
                  formData.status === 0
                    ? "forms-sec-item-status draft"
                    : formData.status === 1
                    ? "forms-sec-item-status active"
                    : "forms-sec-item-status expired"
                }
              >
                {formData.status === 0
                  ? lang.draft
                  : formData.status === 1
                  ? lang.active
                  : lang.expired}
              </div>
            </div>
          </div>

          <div className="right">
            <div className="btn-cnt">
              <SecondaryButton
                label={"back"}
                action={() => router.push("/forms")}
              />

              {formData.status === 2 && (
                <RedSecondaryButton
                  label={"delete"}
                  action={() => router.push("/forms")}
                />
              )}

              {formData.status === 1 && (
                <SecondaryButton
                  label={"terminate"}
                  action={() => router.push("/forms")}
                />
              )}

              {formData.status !== 2 && (
                <PrimaryButton
                  label={"edit"}
                  action={() => router.push("/forms/" + formId + "/edit")}
                />
              )}

              {formData.status === 0 && (
                <GreenPrimaryActionButton
                  label={"publish"}
                  action={() => router.push("/forms/" + formId + "/edit")}
                />
              )}
            </div>
          </div>
        </div>

        <div className="form-view-body">
          <div className="left">
            <div className="button-cnt">
              <PromotionButton
                label={"go_to_analytics"}
                action={() => router.push("/forms/" + formId + "/analytics")}
              />

              <PromotionButton
                label={"data_table_view"}
                action={() => router.push("/forms/" + formId + "/tableview")}
              />
            </div>
            <div className="form-timer">
              <div className="form-timer-header">
                <p className="form-timer-header-text">{lang.form_expiry}</p>
              </div>
              <div className="form-timer-body">
                <p className="form-timer-body-text">
                  {new Date(formData.expiry).toDateString()}
                </p>
              </div>
            </div>
            <div className="form-description">
              <div className="form-description-header">
                <p className="form-description-header-text">
                  {lang.description}
                </p>
              </div>
              <div className="form-description-body">
                <p className="form-description-body-text">
                  {formData.description}
                </p>
              </div>
            </div>
          </div>
          <div className="right">
            <div className="form-preview">
              <div className="form-preview-header ">
                <p className="form-preview-header-text">{lang.form_preview}</p>
              </div>
              <div className="form-preview-body">
                <div className="form-preview-body-cnt">
                  {formData.elements
                    .filter((element: any) => element.column === 1)
                    .map((element: any, index: number) => {
                      return (
                        <DynamicElement
                          openElementProps={false}
                          key={index}
                          data={element}
                        />
                      );
                    })}
                </div>

                <div className="form-preview-body-cnt">
                  {formData.elements
                    .filter((element: any) => element.column === 2)
                    .map((element: any, index: number) => {
                      return (
                        <DynamicElement
                          openElementProps={false}
                          key={index}
                          data={element}
                        />
                      );
                    })}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }
}
