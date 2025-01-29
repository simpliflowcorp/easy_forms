"use client";
import PrimaryActionButton from "@/components/buttons/PrimaryActionButton";
import PrimaryButton from "@/components/buttons/PrimaryButton";
import { useLanguageStore } from "@/store/store";
import axios from "axios";
import exp from "constants";
import { useRouter } from "next/navigation";
import * as React from "react";

export interface IformsProps {}

export default function forms(props: IformsProps) {
  const lang = useLanguageStore((state) => state.language);
  const router = useRouter();

  // const testModel = async () => {
  //   let res = await axios.post("/api/testDb", { test: "T1" });

  // };
  // React.useEffect(() => {
  //   testModel();
  // });

  const barChartData = {};

  const [isActive, setIsActive] = React.useState("all" as string);

  const [gotData, setGotData] = React.useState(false);

  const [data, setData] = React.useState({} as any);

  const [forms, setForms] = React.useState([
    {
      id: 1,
      name: "SIGN UP FORM",
      status: 1,
      expiry: new Date().valueOf() + 24 * 60 * 60 * 1000,
      total_responses: 1,
      today_responses: 10,
    },
    {
      id: 2,
      name: "testing FORM",
      status: 1,
      expiry: new Date().valueOf() + 24 * 60 * 60 * 1000,
      total_responses: 1,
      today_responses: 10,
    },
  ] as any);

  function countDown(expiringDate: number) {
    const now = Date.now();
    const timeRemaining = expiringDate - now;
    const totalHours = Math.floor(timeRemaining / (1000 * 60 * 60));
    const minutes = Math.floor(
      (timeRemaining % (1000 * 60 * 60)) / (1000 * 60)
    );
    const seconds = Math.floor((timeRemaining % (1000 * 60)) / 1000);

    return `${totalHours}h ${minutes}m ${seconds}s`;
  }

  return (
    <div className="forms-cnt">
      <div className="forms-header">
        <div className="left">
          <span className="header-indicator">/</span>
          <span className="header-text">{lang.forms}</span>
        </div>

        <div className="right">
          <PrimaryButton
            label={"create_form"}
            action={() => router.push("/forms/create")}
          />
        </div>
      </div>
      <div className="forms-sec-cnt">
        <div className="forms-sec">
          <div className="forms-sec-control">
            <div className="tab-switch-cnt">
              <div
                onClick={() => setIsActive("all")}
                className={
                  isActive === "all" ? "tab-switch-active" : "tab-switch"
                }
              >
                <div className="tab-switch-text">{lang.all}</div>
              </div>
              <div
                onClick={() => setIsActive("active")}
                className={
                  isActive === "active" ? "tab-switch-active" : "tab-switch"
                }
              >
                <div className="tab-switch-text">{lang.active}</div>
              </div>
              <div
                onClick={() => setIsActive("expired")}
                className={
                  isActive === "expired" ? "tab-switch-active" : "tab-switch"
                }
              >
                <div className="tab-switch-text">{lang.expired}</div>
              </div>
            </div>
          </div>
          <div className="forms-sec-list-cnt">
            <div className="forms-sec-list">
              {forms
                .filter((form: any) => {
                  if (isActive === "all") return true;
                  if (isActive === "active" && form.status === 1) return true;
                  if (isActive === "expired" && form.status === 0) return true;
                  return false;
                })
                .map((form: any) => (
                  <div className="forms-sec-item">
                    <div className="form-sec-header">
                      <div className="form-sec-header-left">
                        <div className="form-sec-header-indicator">/</div>
                        <div className="form-sec-header-text">{form.name}</div>
                      </div>
                      <div className="form-sec-header-right">
                        <div
                          className={
                            form.status === 1
                              ? "forms-sec-item-status active"
                              : "forms-sec-item-status expired"
                          }
                        >
                          {form.status === 1 ? lang.active : lang.expired}
                        </div>
                        {/* <div className="forms-sec-items-options">
                          <i className="ic-three-dots-vertical"></i>
                        </div> */}
                      </div>
                    </div>
                    <div className="forms-sec-item-expiry">
                      {form.status === 1
                        ? lang.form_expiring_in + "  " + countDown(form.expiry)
                        : lang.form_expired_on +
                          " " +
                          new Date(form.expiry).toLocaleDateString()}
                    </div>
                    <div className="forms-sec-item-body-cnt">
                      <div className="forms-sec-item-body-header">
                        {lang.responses_received}
                      </div>
                      <div className="forms-sec-item-body">
                        <div className="forms-sec-item-body-counter">
                          <div className="counter-text">{lang.total}</div>
                          <div className="counter-value">
                            {form.total_responses > 9999
                              ? "9999+"
                              : form.total_responses}
                          </div>
                        </div>
                        <div className="forms-sec-item-body-split"></div>
                        <div className="forms-sec-item-body-counter">
                          <div className="counter-text">{lang.today}</div>
                          <div className="counter-value">
                            {form.today_responses > 9999
                              ? "9999+"
                              : form.today_responses}
                          </div>
                        </div>
                      </div>
                    </div>
                    <div
                      onClick={() => {
                        router.push("/forms/" + form.id);
                      }}
                      className="form-sec-footer"
                    >
                      <span className="form-sec-footer-text">
                        {lang.goto_form}
                      </span>
                      <i className="form-sec-footer-icon ic-box-arrow-right"></i>
                    </div>
                  </div>
                ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
