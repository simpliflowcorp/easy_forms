"use client";
import React from "react";
import META_DATAS from "@/metaData/fieldTypes.json";
import { useLanguageStore } from "@/store/store";
import ComponentsElements from "./ComponentsElements";

type Props = {};

const ComponentsContainer = (props: Props) => {
  const lang = useLanguageStore((state) => state.language);

  const [activeSection, setActiveSection] = React.useState("");

  console.log(META_DATAS);

  return (
    <div className="components-sec-cnt">
      <div className="components-sec">
        <div
          onClick={() => {
            activeSection === "base_components"
              ? setActiveSection("")
              : setActiveSection("base_components");
          }}
          className="components-sec-header"
        >
          <span className="header-text">{lang.base_components}</span>
          <span>
            <i
              className={
                activeSection === "base_components"
                  ? "ic-caret-up-fill "
                  : "ic-caret-down-fill"
              }
            ></i>
          </span>
        </div>
      </div>
      {activeSection === "base_components" ? (
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
      ) : (
        <></>
      )}
      <div className="components-sec">
        <div
          onClick={() => {
            activeSection === "base_components1"
              ? setActiveSection("")
              : setActiveSection("base_components1");
          }}
          className="components-sec-header"
        >
          <span className="header-text">{lang.pre_defined_components}</span>
          <span>
            <i
              className={
                activeSection === "base_components1"
                  ? "ic-caret-up-fill "
                  : "ic-caret-down-fill"
              }
            ></i>
          </span>
        </div>
      </div>
      {activeSection === "base_components1" ? (
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
      ) : (
        <></>
      )}
      {/* <div className="components-sec">
        <div
          onClick={() => {
            setActiveSection((prev) =>
              prev === "base_components2" ? "" : "base_components2"
            );
          }}
          className="components-sec-header"
        >
          <span className="header-text">{lang.base_components + 5}</span>
          <span>
            <i
              className={
                activeSection === "base_components2"
                  ? "ic-caret-up-fill "
                  : "ic-caret-down-fill"
              }
            ></i>
          </span>
        </div>
      </div>
      {activeSection === "base_components2" ? (
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
      ) : (
        <></>
      )} */}
    </div>
  );
};

export default ComponentsContainer;
