"use client";
import DynamicElement from "@/components/builderWorkbench/builderComponents/DynamicElement";
import IconButton from "@/components/buttons/IconButton";
import PrimaryButton from "@/components/buttons/PrimaryButton";
import PromotionButton from "@/components/buttons/PromotionButton";
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

  // const testModel = async () => {
  //   let res = await axios.post("/api/testDb", { test: "T1" });

  // };
  // React.useEffect(() => {
  //   testModel();
  // });

  const barChartData = {};

  const metaData = {
    name: "Form Name",
    description: "A description of the form",
    expriy: new Date(),
    elements: [
      {
        id: 1,
        label: "First Name",
        type: 1,
        required: 1,
        unique: 0,
        column: 1,
        position: 1,
      },
      {
        id: 2,
        label: "Last Name",
        type: 1,
        required: 1,
        unique: 0,
        column: 2,
        position: 1,
      },
      {
        id: 3,
        label: "Email",
        type: 1,
        required: 1,
        unique: 0,
        column: 1,
        position: 2,
      },
      {
        id: 4,
        label: "Phone",
        type: 1,
        required: 1,
        unique: 0,
        column: 2,
        position: 2,
      },
      {
        id: 5,
        label: "Address",
        type: 1,
        required: 1,
        unique: 0,
        column: 1,
        position: 3,
      },
    ],
  };

  return (
    <div className="form-cnt">
      <div className="form-header">
        <div className="left">
          <span className="header-indicator">/</span>
          <span className="header-text">{metaData.name}</span>
        </div>

        <div className="right">
          <div className="btn-cnt">
            <SecondaryButton
              label={"back"}
              action={() => router.push("/forms")}
            />

            <SecondaryButton
              label={"terminate"}
              action={() => router.push("/forms")}
            />

            <SecondaryButton
              label={"delete"}
              action={() => router.push("/forms")}
            />

            <PrimaryButton
              label={"edit"}
              action={() => router.push("/forms/create")}
            />
          </div>
        </div>
      </div>

      <div className="form-view-body">
        <div className="left">
          <div className="button-cnt">
            <PromotionButton
              label={"go_to_analytics"}
              action={() => router.push("/forms")}
            />
          </div>
          <div className="form-timer">
            <div className="form-timer-header">
              <p className="form-timer-header-text">Form Expiry</p>
            </div>
            <div className="form-timer-body">
              <p className="form-timer-body-text">
                {metaData.expriy.toDateString()}
              </p>
            </div>
          </div>
          <div className="form-description">
            <div className="form-description-header">
              <p className="form-description-header-text">Description</p>
            </div>
            <div className="form-description-body">
              <p className="form-description-body-text">
                {metaData.description}
              </p>
            </div>
          </div>
        </div>
        <div className="right">
          <div className="form-preview">
            <div className="form-preview-header">
              <p className="form-preview-header-text">Form Preview</p>
            </div>
            <div className="form-preview-body">
              <div className="form-preview-body-cnt">
                {metaData.elements
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
                {metaData.elements
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
