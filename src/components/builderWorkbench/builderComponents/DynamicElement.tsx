"use client";
import React from "react";
import TextFieldElement from "./TextFieldElement";
import SelectFieldElement from "./SelectFieldElement";
import CheckboxFieldElement from "./CheckboxFieldElement";
import RadioFieldElement from "./RadioFieldElement";
import ColorPickerElement from "./ColorPickerElement";
import RangePickerElement from "./RangePickerElement";
import DatePickerElement from "./DatePickerElement";
import DateTimePickerElement from "./DateTimePickerElement";
import TimePickerElement from "./TimePickerElement";
import { useSortable } from "@dnd-kit/sortable";

type Props = {
  data: any;
};

const DynamicElement = (props: Props) => {
  const { listeners, setNodeRef, attributes } = useSortable({
    id: props.data.id,
  });

  const dynamicElement = () => {
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
      case 21:
        return <DatePickerElement data={props.data} />;
      case 22:
        return <TimePickerElement data={props.data} />;
      case 23:
        return <DateTimePickerElement data={props.data} />;
      default:
        return <TextFieldElement data={props.data} />;
    }
  };
  return (
    <div ref={setNodeRef} {...attributes} {...listeners}>
      {dynamicElement()}
    </div>
  );
};

export default DynamicElement;
