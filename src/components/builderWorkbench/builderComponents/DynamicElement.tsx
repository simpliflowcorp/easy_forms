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
import { CSS } from "@dnd-kit/utilities";
import ElementOptionPopup from "./ElementOptionPopup";
import { log } from "console";

type Props = {
  data: any;
  openElementProps: any;
};

const DynamicElement = (props: Props) => {
  const {
    listeners,
    setNodeRef,
    attributes,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: props.data.id,
    data: {
      type: "element",
      comp: props.data,
    },
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const [isOptionsOpen, setIsOptionsOpen] = React.useState(false as boolean);

  const closePopup = () => {
    setIsOptionsOpen(false);
  };

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

  const currentPath = window.location.pathname.split("/").pop();
  console.log("currentPath", currentPath);

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={
        isDragging
          ? "form-field-element-cnt dragging-element-placeholder"
          : "form-field-element-cnt"
      }
      {...attributes}
      {...listeners}
    >
      <div className="form-field-element">
        <div className="form-field-element-label">
          <span className="form-field-element-label-text">
            {props.data.label}
          </span>
          {currentPath === "create" || currentPath === "edit" ? (
            <i
              onClick={() => {
                setIsOptionsOpen(!isOptionsOpen);
              }}
              className=" form-field-element-options ic-three-dots-vertical"
            ></i>
          ) : null}
        </div>
        {dynamicElement()}
        {isOptionsOpen ? (
          <ElementOptionPopup
            data={props.data}
            openElementProps={props.openElementProps}
            isOptionsOpen
            closePopup={closePopup}
          />
        ) : null}
      </div>
    </div>
  );
};

export default DynamicElement;
