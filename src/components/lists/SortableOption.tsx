import { useSortable } from "@dnd-kit/sortable";
import React, { useEffect } from "react";
import { CSS } from "@dnd-kit/utilities";
export interface ISortableOptionProps {
  data: any;
  updateOptionsValue: (options: any[]) => void;
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

  const [data, setData] = React.useState(props.data);

  useEffect(() => {
    setData(props.data);
  }, [props.data]);

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      style={style}
      className={
        isDragging
          ? "option-field-element-cnt  dragging-element-placeholder"
          : "option-field-element-cnt"
      }
    >
      <div className="option-field-element">
        <div className="input-cnt">
          <input
            className="input"
            type="text"
            onChange={(e) => {
              setData({ ...data, label: e.target.value });
            }}
            value={data.label}
            onBlur={() => {
              props.updateOptionsValue(data);
            }}
          />
        </div>
        <div className="option-field-element-options">
          <i className=" ic-trash"></i>
        </div>
      </div>
    </div>
  );
}
