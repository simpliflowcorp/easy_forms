import {
  DndContext,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { SortableContext } from "@dnd-kit/sortable";
import React from "react";
import SortableOption from "./SortableOption";

export interface ISortableOptionListProps {
  options: any[];
  updateOptions: (options: any[]) => void;
}

export default function SortableOptionList(props: ISortableOptionListProps) {
  const [activeElement, setActiveElement] = React.useState({} as any);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 10 },
    })
  );

  console.log(props.options);

  return (
    <div className="sortable-list-cnt">
      <div className="sortable-list">
        <div className="sortable-list-header">
          <span>Options List</span>
          <button
            onClick={() => {
              const newOptions = [...props.options];
              newOptions.push({
                label: "New Option",
                value: "new_option",
              });
              props.updateOptions(newOptions);
            }}
          >
            Add Option
          </button>
        </div>
        <DndContext
          sensors={sensors}
          collisionDetection={pointerWithin}
          onDragStart={(e: any) => {
            if (e) {
              setActiveElement(e.active.data.current.comp);
            }
          }}
        >
          <SortableContext items={props.options}>
            {props.options.map((option, index) => {
              return <SortableOption key={index} data={option} />;
            })}
            ;
          </SortableContext>
        </DndContext>
      </div>
    </div>
  );
}
