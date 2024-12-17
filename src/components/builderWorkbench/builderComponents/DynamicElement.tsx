"use client";
import React from "react";
import TextFieldElement from "./textFieldElement";
import SelectFieldElement from "./SelectFieldElement";

type Props = {
  data: any;
};

const DynamicElement = (props: Props) => {
  const dynamicElement = () => {
    console.log(props.data);

    switch (props.data.type) {
      case 1:
      case 2:
      case 3:
      case 4:
      case 5:
        return <TextFieldElement data={props.data} />;
      case 11:
      case 12:
        return <SelectFieldElement data={props.data} />;
      default:
        return <div></div>;
    }
  };
  return <div>{dynamicElement()}</div>;
};

export default DynamicElement;
