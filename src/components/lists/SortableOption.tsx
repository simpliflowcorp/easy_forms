import { useSortable } from "@dnd-kit/sortable";
import React from "react";
import { CSS } from "@dnd-kit/utilities";
export interface ISortableOptionProps {
  data: any;
}

export default function SortableOption(props: ISortableOptionProps) {
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
      type: "options",
      comp: props.data,
    },
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={
        isDragging ? "option-field-element-cnt" : "option-field-element-cnt"
      }
      {...attributes}
      {...listeners}
    >
      <div className="option-field-element">
        <div className="option-field-element-label">
          {props.data.label}
          <i className=" option-field-element-options ic-three-dots-vertical"></i>
        </div>
      </div>
    </div>
  );
}
