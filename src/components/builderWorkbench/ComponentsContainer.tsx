"use client";
import React from "react";
import META_DATAS from "@/metaData/fieldTypes.json";
import { useLanguageStore } from "@/store/store";
import ComponentsElements from "./ComponentsElements";

type Props = {};

const ComponentsContainer = (props: Props) => {
  const lang = useLanguageStore((state) => state.language);

  return (
    <div className="components-sec-cnt">
      <div className="components-sec">
        <div className="components-sec-header">
          <span className="header-indicator"></span>
          <span className="header-text">{lang.base_components}</span>
        </div>
        <div className="components-sec-body">
          <div className="components-sec-list">
            {META_DATAS.map((data: any, index: number) => {
              return (
                <ComponentsElements
                  key={"id" + index}
                  id={"base_components" + data.type}
                  data={data}
                />
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ComponentsContainer;
