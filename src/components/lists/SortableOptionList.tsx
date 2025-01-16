"use client";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import React from "react";
import SortableOption from "./SortableOption";
import { useLanguageStore } from "@/store/store";
import SecondaryButton from "../buttons/SecondaryButton";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";

export interface ISortableOptionListProps {
  options: any[];
  updateOptions: (options: any[]) => void;
}

export default function SortableOptionList(props: ISortableOptionListProps) {
  const lang = useLanguageStore((state) => state.language);
  const [activeElement, setActiveElement] = React.useState({} as any);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 10 },
    })
  );

  const updateOptionsValue = (data: any) => {
    let newOptions = [
      ...props.options.map((option) => (option.id === data.id ? data : option)),
    ];
    props.updateOptions(newOptions);
  };

  return (
    <div className="sortable-list-cnt">
      <div className="sortable-list">
        <div className="sortable-list-header">
          <span>Options List</span>
          <SecondaryButton
            label="add"
            action={() => {
              const newOptions = [...props.options];
              newOptions.push({
                id: new Date().getTime(),
                label: "New Option",
                value: "new_option",
              });
              props.updateOptions(newOptions);
            }}
          />
        </div>
        <div className="sortable-list-body">
          <DndContext
            sensors={sensors}
            collisionDetection={pointerWithin}
            modifiers={[restrictToVerticalAxis]}
            onDragStart={(e: any) => {
              if (e) {
                console.log(e.active.data.current.comp);
                setActiveElement(e.active.data.current.comp);
              }
            }}
            onDragOver={(e: any) => {
              const { active, over } = e;
              const activeId = active.id;
              if (over === null) return;
              const overId = over.id;
              if (activeId === overId) return;
              let items = props.options;
              const oldIndex = items.indexOf(active.data.current.comp);
              const newIndex = items.indexOf(over.data.current.comp);
              console.log({ oldIndex, newIndex });
              let arryMoveVar = arrayMove(items, oldIndex, newIndex);
              props.updateOptions(arryMoveVar);
            }}
          >
            <SortableContext
              strategy={verticalListSortingStrategy}
              items={props.options}
            >
              {props.options.map((option, index) => {
                return (
                  <SortableOption
                    updateOptionsValue={updateOptionsValue}
                    key={index}
                    data={option}
                  />
                );
              })}
            </SortableContext>
            <DragOverlay>
              {activeElement && (
                <div className="option-field-element-cnt">
                  <div className="option-field-element">
                    <div className="option-field-element-label">
                      {activeElement.label}
                    </div>
                    <i className=" option-field-element-options ic-three-dots-vertical"></i>
                  </div>
                </div>
              )}
            </DragOverlay>
          </DndContext>
        </div>
      </div>
    </div>
  );
}
