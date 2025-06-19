"use client";
import React, { useEffect } from "react";
import { useLanguageStore } from "@/store/store";
import axios from "axios";
import PrimaryActionButton from "@/components/buttons/PrimaryActionButton";
import DynamicElement from "@/components/builderWorkbench/builderComponents/DynamicElement";
import DynamicFieldManger from "@/components/Inputs/DynamicFieldManger";
import { set } from "lodash";
import SuccessAnimation from "@/components/Animations/SuccessAnimation";
import { errorHandler } from "@/helper/errorHandler";
import { useRouter } from "next/navigation";
import ErrorAnimation from "@/components/Animations/ErrorAnimation";

type Props = {};

const Publish = (props: Props) => {
  const lang = useLanguageStore((state) => state.language);
  const router = useRouter();

  const [forms, setForms] = React.useState([] as any);
  const [gotData, setGotData] = React.useState(false);

  const [formId, setFormId] = React.useState("");

  const [resetBtn, setResetBtn] = React.useState(0);

  const [data, setData] = React.useState({});
  const [dataIsValid, setDataIsValid] = React.useState({});
  const [formSubitted, setFormSubmitted] = React.useState(false);
  const [formExpired, setFormExpired] = React.useState(false);

  const getFormData = async () => {
    let formId = window.location.pathname.split("/")[2];
    setFormId(formId);
    try {
      const res = await axios.get("/api/openpath/read");
      if (res.status === 200) {
        setForms(res.data.data);
        setGotData(true);

        if (res.data.data.isExpired) {
          setFormExpired(true);
        }

        const datas = res.data.data.elements.reduce(
          (accumulator: any, current: any) => {
            accumulator[current.label] = "";
            return accumulator;
          },
          {}
        );
        console.log(res.data.data);

        setData(datas);
        setDataIsValid(datas);
      }
    } catch (error: any) {
      router.push("/404");
    }
  };

  useEffect(() => {
    getFormData();
  }, []);

  const submitForm = async () => {
    // check is required fields are filled
    let requiredFields = forms.elements.filter(
      (element: any) => element.required
    );

    let isValid = requiredFields.reduce((acc: boolean, curr: any) => {
      return (acc =
        acc && dataIsValid[curr.label as keyof typeof dataIsValid] === true);
    }, true);

    if (isValid) {
      try {
        const response = await fetch("/api/openpath/submit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            form_id: formId,
            data: data,
          }),
        });
        const result = await response.json();

        if (!response.ok) {
          console.log(result);
          setFormExpired(true);
          return;
        }

        setFormSubmitted(true);
      } catch (error) {
        console.error("Submission error:", error);
        errorHandler(errorHandler, lang);
      }
    } else {
      errorHandler(
        {
          response: {
            data: {
              message: "Please fill in all required fields",
            },
          },
        },
        lang
      );
      setResetBtn((prev) => prev + 1);
    }
  };

  const updateVauleFn = (element: any, value: any) => {
    switch (element.type) {
      default:
        setData({ ...data, [element.label]: value });
        return;
    }
  };

  if (!gotData) {
    return <div className="accent-line-loader"></div>;
  } else {
    return (
      <div className="publish-cnt">
        {formSubitted && (
          <div className="publish-success">
            <p className="success-text">{lang.form_submitted_successfully}</p>
            <SuccessAnimation />
            <p className="success-text">{lang.thanks_for_your_response}</p>
          </div>
        )}

        {formExpired && (
          <div className="publish-success">
            <p className="success-text">{lang.form_expired}</p>
            <ErrorAnimation />
            <p className="success-text">{lang.please_contact_the_form_owner}</p>
          </div>
        )}

        {!formSubitted && !formExpired && (
          <div className="publish-form-wrapper">
            <div className="publish-form">
              <div className="form-header">
                <span className="header-indicator">/</span>
                <span className="header-text">{forms.name}</span>
              </div>
              <div className="form-body">
                {forms.elements.filter((element: any) => element.column === 1)
                  .length > 0 && (
                  <div className="form-body-comp">
                    {forms.elements
                      .filter((element: any) => element.column === 1)
                      .map((element: any, index: number) => {
                        return (
                          <DynamicFieldManger
                            reset={resetBtn}
                            key={index + "l" + 1}
                            label={element.label}
                            options={element.options ? element.options : []}
                            value={data[element.label as keyof typeof data]}
                            updateValue={(value: any) => {
                              updateVauleFn(element, value);
                            }}
                            isRequired={element.required}
                            isValid={
                              dataIsValid[
                                element.label as keyof typeof dataIsValid
                              ]
                            }
                            updateIsValid={(value: boolean) =>
                              setDataIsValid((p) => ({
                                ...p,
                                [element.label]: value,
                              }))
                            }
                            type={element.type}
                          />
                        );
                      })}
                  </div>
                )}
                {forms.elements.filter((element: any) => element.column === 2)
                  .length > 0 && (
                  <div className="form-body-comp">
                    {forms.elements
                      .filter((element: any) => element.column === 2)
                      .map((element: any, index: number) => {
                        return (
                          <DynamicFieldManger
                            key={index + "r" + 2}
                            reset={resetBtn}
                            label={element.label}
                            options={element.options ? element.options : []}
                            value={data[element.label as keyof typeof data]}
                            updateValue={(value: any) => {
                              updateVauleFn(element, value);
                            }}
                            isRequired={element.required}
                            isValid={
                              dataIsValid[
                                element.label as keyof typeof dataIsValid
                              ]
                            }
                            updateIsValid={(value: boolean) =>
                              setDataIsValid((p) => ({
                                ...p,
                                [element.label]: value,
                              }))
                            }
                            type={element.type}
                          />
                        );
                      })}
                  </div>
                )}
              </div>
              <div className="form-footer">
                <div className="btn-wrapper">
                  <PrimaryActionButton
                    label="submit"
                    resetBtn={resetBtn}
                    action={() => submitForm()}
                  />
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }
};
export default Publish;
