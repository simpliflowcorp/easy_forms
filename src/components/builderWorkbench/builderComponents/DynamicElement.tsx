"use client";
import React from "react";
import TextFieldElement from "./TextFieldElement";
import SelectFieldElement from "./SelectFieldElement";
import CheckboxFieldElement from "./CheckboxFieldElement";
import RadioFieldElement from "./RadioFieldElement";
import ColorPickerElement from "./ColorPickerElement";
import RangePickerElement from "./RangePickerElement";

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
      case 13:
        return <CheckboxFieldElement data={props.data} />;
      case 14:
        return <RadioFieldElement data={props.data} />;
      case 15:
        return <ColorPickerElement data={props.data} />;
      case 16:
        return <RangePickerElement data={props.data} />;
      case 17:
        return <RangePickerElement data={props.data} />;
      case 18:
        return <RangePickerElement data={props.data} />;
      case 19:
        return <RangePickerElement data={props.data} />;
      default:
        return <TextFieldElement data={props.data} />;
    }
  };
  return <>{dynamicElement()}</>;
};

export default DynamicElement;
