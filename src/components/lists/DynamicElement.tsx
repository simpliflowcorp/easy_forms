"use client";
import React from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

type Props = {
  data: any;
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
          {props.data.label}
          <i
            onClick={() => {
              setIsOptionsOpen(!isOptionsOpen);
            }}
            className=" form-field-element-options ic-three-dots-vertical"
          ></i>
        </div>
        test
      </div>
    </div>
  );
};

export default DynamicElement;
