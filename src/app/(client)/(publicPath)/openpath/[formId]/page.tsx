"use client";
import React, { useEffect } from "react";
import { useLanguageStore } from "@/store/store";
import axios from "axios";
import PrimaryActionButton from "@/components/buttons/PrimaryActionButton";
import DynamicElement from "@/components/builderWorkbench/builderComponents/DynamicElement";
import DynamicFieldManger from "@/components/Inputs/DynamicFieldManger";

type Props = {};

const Publish = (props: Props) => {
  const lang = useLanguageStore((state) => state.language);

  const [forms, setForms] = React.useState([] as any);
  const [gotData, setGotData] = React.useState(false);

  const getFormData = async () => {
    let formId = window.location.pathname.split("/")[2];

    try {
      const res = await axios.get("/api/form/read");
      if (res.status === 200) {
        setForms(res.data.data);
        setGotData(true);
        const datas = res.data.data.elements.reduce(
          (accumulator: any, current: any) => {
            accumulator[current.label] = "";
            return accumulator;
          },
          {}
        );

        console.log(datas);

        setData(datas);
      }
    } catch (error: any) {
      console.log(error);
    }
    console.log(formId);
  };

  console.log(forms);

  useEffect(() => {
    getFormData();
  }, []);

  const [resetBtn, setResetBtn] = React.useState(0);

  const [data, setData] = React.useState({});
  const [dataIsValid, setDataIsValid] = React.useState({});

  console.log(data);

  if (!gotData) {
    return <div className="accent-line-loader"></div>;
  } else {
    return (
      <div className="publish-cnt">
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
                          label={element.label}
                          options={element.options ? element.options : []}
                          // value={data[item.name]}
                          value={data[element.label as keyof typeof data]}
                          updateValue={(value: string) =>
                            setData({ ...data, [element.name]: value })
                          }
                          isRequired={false}
                          // isValid={dataIsValid[item.name]}
                          isValid={
                            dataIsValid[
                              element.name as keyof typeof dataIsValid
                            ]
                          }
                          updateIsValid={(value: boolean) =>
                            setDataIsValid((p) => ({
                              ...p,
                              [element.name]: value,
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
                      console.log(data[element.label as keyof typeof data]);

                      return (
                        <DynamicFieldManger
                          reset={resetBtn}
                          label={element.label}
                          options={element.options ? element.options : []}
                          value={data[element.label as keyof typeof data]}
                          updateValue={(value: string) =>
                            setData({ ...data, [element.name]: value })
                          }
                          isRequired={false}
                          // isValid={dataIsValid[item.name]}
                          isValid={
                            dataIsValid[
                              element.name as keyof typeof dataIsValid
                            ]
                          }
                          updateIsValid={(value: boolean) =>
                            setDataIsValid((p) => ({
                              ...p,
                              [element.name]: value,
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
                  resetBtn={0}
                  action={() => {}}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }
};
export default Publish;
