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

  const [gotData, setGotData] = React.useState(false);
  const [formData, setFormData] = React.useState({
    name: "SIGN UP FORM",
    description:
      "This is a sign up form. Used to collect user data for the upcoming event. The form includes fields for first name, last name, email, phone, and address. Each field is required to ensure we gather all necessary information from the users. The form is divided into two columns for better organization and readability. The form will expire in two days from now, and its current status is active. Users can fill out the form to register for the event, and the collected data will be used for event planning and communication purposes.",
    expriy: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
    status: 1,
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
      {
        id: 6,
        label: "Select Option",
        type: 11,
        required: 1,
        unique: 0,
        column: 2,
        position: 3,
        option: [
          { id: 1, label: "Option 1" },
          { id: 2, label: "Option 2" },
          { id: 3, label: "Option 3" },
          { id: 4, label: "Option 4" },
          { id: 5, label: "Option 5" },
        ],
      },
    ],
  } as any);

  // const testModel = async () => {
  //   let res = await axios.post("/api/testDb", { test: "T1" });

  // };
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
    getFormData();
  }, []);

  const barChartData = {};

  console.log(formData);

  const formDatatemp = {
    name: "SIGN UP FORM",
    description:
      "This is a sign up form. Used to collect user data for the upcoming event. The form includes fields for first name, last name, email, phone, and address. Each field is required to ensure we gather all necessary information from the users. The form is divided into two columns for better organization and readability. The form will expire in two days from now, and its current status is active. Users can fill out the form to register for the event, and the collected data will be used for event planning and communication purposes.",
    expriy: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
    status: 1,
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
      {
        id: 6,
        label: "Select Option",
        type: 11,
        required: 1,
        unique: 0,
        column: 2,
        position: 3,
        option: [
          { id: 1, label: "Option 1" },
          { id: 2, label: "Option 2" },
          { id: 3, label: "Option 3" },
          { id: 4, label: "Option 4" },
          { id: 5, label: "Option 5" },
        ],
      },
    ],
  };

  console.log(formData.elements);

  console.log(new Date(formData.expiry).toDateString());

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
                formData.status === 1
                  ? "forms-sec-item-status active"
                  : "forms-sec-item-status expired"
              }
            >
              {formData.status === 1 ? lang.active : lang.expired}
            </div>
          </div>
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
              action={() => router.push("/forms/" + 1 + "/edit")}
            />
          </div>
        </div>
      </div>

      <div className="form-view-body">
        <div className="left">
          <div className="button-cnt">
            <PromotionButton
              label={"go_to_analytics"}
              action={() => router.push("/forms/" + 1 + "/analytics")}
            />

            <PromotionButton
              label={"data_table_view"}
              action={() => router.push("/forms/" + 1 + "/tableview")}
            />
          </div>
          <div className="form-timer">
            <div className="form-timer-header">
              <p className="form-timer-header-text">{lang.form_expiry}</p>
            </div>
            <div className="form-timer-body">
              <p className="form-timer-body-text">
                {/* {new Date().toDateString()} */}
                {/* {new Date(formData.expiry)} */}
                {new Date(formData.expiry).toDateString()}
              </p>
            </div>
          </div>
          <div className="form-description">
            <div className="form-description-header">
              <p className="form-description-header-text">{lang.description}</p>
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
