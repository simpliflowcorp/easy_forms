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
      type: "element",
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
          <i className=" form-field-element-options ic-three-dots-vertical"></i>
        </div>
      </div>
    </div>
  );
}
