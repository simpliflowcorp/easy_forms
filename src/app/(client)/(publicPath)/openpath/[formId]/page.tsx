"use client";
import React, { useEffect } from "react";
import { useLanguageStore } from "@/store/store";
import axios from "axios";
import PrimaryActionButton from "@/components/buttons/PrimaryActionButton";
import DynamicElement from "@/components/builderWorkbench/builderComponents/DynamicElement";

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
                        <DynamicElement
                          openElementProps={false}
                          key={index}
                          data={element}
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
                        <DynamicElement
                          openElementProps={false}
                          key={index}
                          data={element}
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
