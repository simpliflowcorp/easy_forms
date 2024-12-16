"use client";
import { useLanguageStore } from "@/store/store";
import { useDraggable } from "@dnd-kit/core";
import React from "react";

type Props = {
  id: string;
  data: any;
};

const ComponentsElements = (props: Props) => {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id: props.id,
      data: { comp: props.data, type: "component" },
    });
  const lang = useLanguageStore((state) => state.language);
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className="components-sec-list-item"
    >
      <i className={" components-sec-list-item-icon ic-" + props.data.icon}></i>
      <span>{lang[props.data.label]}</span>
    </div>
  );
};

export default ComponentsElements;
