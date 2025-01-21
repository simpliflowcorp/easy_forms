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
import React, { use } from "react";
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

  const isCap = React.useRef(props.options.length);
  const isCount = React.useRef(props.options.length);

  React.useEffect(() => {
    isCap.current = props.options.length;
  }, []);

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

  const deleteOptionsValue = (data: any) => {
    let newOptions = [
      ...props.options.filter((option) => option.id !== data.id),
    ];
    props.updateOptions(newOptions);
    isCap.current--;
  };

  return (
    <div className="sortable-list-cnt">
      <div className="sortable-list">
        <div className="sortable-list-header">
          <span>Options List</span>
          <SecondaryButton
            isDisabled={
              isCap.current >=
              parseInt(process.env.NEXT_PUBLIC_ELEMENT_OPTIONS_LIMIT || "0", 10)
            }
            label="add"
            action={() => {
              const limit = parseInt(
                process.env.NEXT_PUBLIC_ELEMENT_OPTIONS_LIMIT || "0",
                10
              );

              if (isCap.current <= limit) {
                isCap.current++;
                isCount.current++;
                const newOptions = [...props.options];
                newOptions.push({
                  id: new Date().getTime(),
                  label: "New Option" + " " + isCount.current,
                  value: "new_option" + " " + isCount.current,
                });
                props.updateOptions(newOptions);
              }
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
                    isCap={isCap.current}
                    updateOptionsValue={updateOptionsValue}
                    deleteOptionsValue={deleteOptionsValue}
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
                    <div className="input-cnt">
                      <input
                        className="input"
                        type="text"
                        value={activeElement.label}
                      />
                    </div>
                    <i className=" option-field-element-options "></i>
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
