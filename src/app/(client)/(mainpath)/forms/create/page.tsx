"use client";
import PrimaryActionButton from "@/components/buttons/PrimaryActionButton";
import PrimaryButton from "@/components/buttons/PrimaryButton";
import { useLanguageStore } from "@/store/store";
import axios from "axios";
import exp from "constants";
import { useRouter } from "next/navigation";
import * as React from "react";
import META_DATAS from "@/metaData/fieldTypes.json";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import ComponentsContainer from "@/components/builderWorkbench/ComponentsContainer";
import ComponentsElements from "@/components/builderWorkbench/ComponentsElements";
import FormWorkbenchCnt from "@/components/builderWorkbench/FormWorkbenchCnt";
import DynamicElement from "@/components/builderWorkbench/builderComponents/DynamicElement";
import { arrayMove } from "@dnd-kit/sortable";
import { log } from "console";
export interface IformsProps {}

export default function forms(props: IformsProps) {
  const lang = useLanguageStore((state) => state.language);
  const router = useRouter();

  const [isActive, setIsActive] = React.useState("all" as string);
  const [gotData, setGotData] = React.useState(false);
  const [data, setData] = React.useState({} as any);

  const [components, setComponents] = React.useState([] as any);
  const [form, setForm] = React.useState([
    {
      id: 1,
      label: "First Name",
      type: 1,
      required: 1,
      unique: 0,
      column: 1,
      position: 1,
    },
    {
      id: 2,
      label: "Last Name",
      type: 1,
      required: 1,
      unique: 0,
      column: 2,
      position: 1,
    },
    {
      id: 3,
      label: "Email",
      type: 1,
      required: 1,
      unique: 0,
      column: 1,
      position: 2,
    },
    {
      id: 4,
      label: "Phone",
      type: 1,
      required: 1,
      unique: 0,
      column: 2,
      position: 2,
    },
    {
      id: 5,
      label: "Address",
      type: 1,
      required: 1,
      unique: 0,
      column: 1,
      position: 3,
    },
    {
      id: 6,
      label: "City",
      type: 1,
      required: 1,
      unique: 0,
      column: 2,
      position: 3,
    },
    {
      id: 7,
      label: "State",
      type: 1,
      required: 1,
      unique: 0,
      column: 1,
      position: 4,
    },
    {
      id: 8,
      label: "Country",
      type: 11,
      required: 1,
      unique: 0,
      column: 2,
      position: 4,
    },
    {
      id: 9,
      label: "Zip Code",
      type: 1,
      required: 1,
      unique: 0,
      column: 1,
      position: 5,
    },
    {
      id: 10,
      label: "select Code",
      type: 11,
      required: 1,
      unique: 0,
      column: 2,
      position: 5,
    },
    {
      id: 11,
      label: "Check",
      type: 13,
      required: 1,
      unique: 0,
      column: 1,
      options: [
        { label: "Option 1", value: 0 },
        { label: "Option 2", value: 0 },
        { label: "Option 3", value: 0 },
      ],
      position: 6,
    },
    {
      id: 12,
      label: "Radio",
      type: 14,
      required: 1,
      unique: 0,
      column: 2,
      options: [
        { label: "Option 1", value: 0 },
        { label: "Option 2", value: 0 },
        { label: "Option 3", value: 0 },
      ],
      position: 6,
    },
    {
      id: 13,
      label: "Color",
      type: 15,
      required: 1,
      unique: 0,
      column: 1,
      position: 7,
    },
    {
      id: 14,
      label: "range",
      type: 16,
      required: 1,
      unique: 0,
      column: 2,
      position: 7,
    },
    {
      id: 15,
      label: "date",
      type: 21,
      required: 1,
      unique: 0,
      column: 1,
      position: 8,
    },
    {
      id: 16,
      label: "time",
      type: 22,
      required: 1,
      unique: 0,
      column: 2,
      position: 8,
    },
    {
      id: 17,
      label: "datetime",
      type: 23,
      required: 1,
      unique: 0,
      column: 1,
      position: 9,
    },
    {
      id: 18,
      label: "file",
      type: 32,
      required: 1,
      unique: 0,
      column: 2,
      position: 9,
    },
    {
      id: 19,
      label: "image",
      type: 31,
      required: 1,
      unique: 0,
      column: 1,
      position: 10,
    },
    {
      id: 20,
      label: "signature",
      type: 33,
      required: 1,
      unique: 0,
      column: 2,
      position: 10,
    },
    {
      id: 21,
      label: "textarea",
      type: 41,
      required: 1,
      unique: 0,
      column: 1,
      position: 11,
    },
  ] as any);

  const [activeElement, setActiveElement] = React.useState({} as any);
  const [activeElementType, setActiveElementType] = React.useState(
    "" as string
  );
  const newElementCountRef = React.useRef(101);
  const addedElementCountRef = React.useRef(101);

  React.useEffect(() => {}, []);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 10 },
    })
  );

  const dynamicOverlay = () => {
    if (activeElement) {
      if (activeElementType === "element") {
        return (
          <div className="drag-overlay-item">
            <DynamicElement data={activeElement} />
          </div>
        );
      } else if (activeElementType === "component") {
        return (
          <div className="drag-overlay-item">
            <ComponentsElements id="active" data={activeElement} />
          </div>
        );
      }
    }
  };

  const updateFormElement = (element: any) => {
    const newForm = form.map((el: any) => {
      if (el.id === element.id) {
        return element;
      }
      return el;
    });
    setForm(newForm);
  };

  const changeElementColumn = (element: any, column: number) => {
    const newForm = form.map((el: any) => {
      if (el.id === element.id) {
        return { ...element, column };
      }
      return el;
    });
    setForm(newForm);
  };

  const dragEndHandeler = (e: any) => {
    console.log({ e });
    const { active, over } = e;
    const activeId = active.id;

    if (over === null) return;
    const overId = over.id;
    const overType = over.data.current.type;
    if (activeId === overId) return;
    setForm((items: any) => {
      const oldIndex = items.indexOf(active.data.current.comp);
      const newIndex = items.indexOf(over.data.current.comp);
      console.log({ oldIndex, newIndex });
      let arryMoveVar = arrayMove(items, oldIndex, newIndex);
      return arryMoveVar;
    });

    if (activeElementType === "component") {
      let id = active.id;
      setForm((item: any) => {
        let newform = [
          ...item.map((e: any) => {
            if (e.id === id) {
              console.log({ e });
              return { ...e, id: newElementCountRef.current };
            } else {
              return e;
            }
          }),
        ];
        return newform;
      });
      newElementCountRef.current++;
    }
  };

  const dragOverHandeler = (e: any) => {
    const { active, over } = e;

    if (!active || !over) return;

    console.log({ active, over, activeElementType });

    let ex = {
      id: 21,
      label: "textarea",
      type: 41,
      required: 1,
      unique: 0,
      column: 1,
      position: 11,
    };

    if (over.data.current?.comp) {
      console.log({ active, over });
      if (activeElementType === "component") {
        let newElement = {
          id: active.id,
          label: activeElement.label + " " + newElementCountRef.current,
          type: activeElement.type,
          column: over.data.current.comp.column,
          required: 0,
          unique: 0,
          position: 0,
        };

        if (activeElement.type === 13 || activeElement.type === 14) {
          newElement = {
            ...newElement,
            options: [
              { label: "Option 1", value: 0 },
              { label: "Option 2", value: 0 },
              { label: "Option 3", value: 0 },
            ],
          };
        }

        console.log(form);

        if (addedElementCountRef.current === newElementCountRef.current) {
          setForm((items: any) => {
            let arryMoveVar = [...items, newElement];
            return arryMoveVar;
          });
          addedElementCountRef.current++;
        } else {
          if (
            active.data.current.comp.column !== over.data.current.comp.column
          ) {
            changeElementColumn(
              active.data.current.comp,
              over.data.current.comp.column
            );
          }
        }
      } else {
        if (active.data.current.comp.column !== over.data.current.comp.column) {
          changeElementColumn(
            active.data.current.comp,
            over.data.current.comp.column
          );
        }
      }
    }
  };

  console.log(form);

  return (
    <div className="form-cnt">
      <div className="form-header">
        <div className="left">
          <span className="header-indicator">/</span>
          <span className="header-text">{lang.create_form}</span>
        </div>

        <div className="right">
          <PrimaryButton
            label={"save"}
            action={() => router.push("/forms/create")}
          />
        </div>
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={pointerWithin}
        onDragStart={(e: any) => {
          if (e) {
            setActiveElement(e.active.data.current.comp);
            setActiveElementType(e.active.data.current.type);
          }
          console.log({ e });
        }}
        onDragOver={(e: any) => {
          dragOverHandeler(e);
        }}
        onDragEnd={(e: any) => {
          dragEndHandeler(e);
        }}
      >
        <div className="form-sec-cnt">
          <div className="form-sec">
            <ComponentsContainer />
            <FormWorkbenchCnt form={form} />
          </div>
        </div>
        <DragOverlay
          dropAnimation={{
            duration: 500,
            easing: "cubic-bezier(0.645, 0.045, 0.355, 1.000)",
          }}
          className="drag-overlay"
        >
          {activeElement && dynamicOverlay()}
        </DragOverlay>
      </DndContext>
    </div>
  );
}
