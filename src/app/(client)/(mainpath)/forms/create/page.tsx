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
    },
    {
      id: 2,
      label: "Last Name",
      type: 1,
      required: 1,
      unique: 0,
      column: 2,
    },
    {
      id: 3,
      label: "Email",
      type: 1,
      required: 1,
      unique: 0,
      column: 1,
    },
    {
      id: 4,
      label: "Phone",
      type: 1,
      required: 1,
      unique: 0,
      column: 2,
    },
    {
      id: 5,
      label: "Address",
      type: 1,
      required: 1,
      unique: 0,
      column: 1,
    },
    {
      id: 6,
      label: "City",
      type: 1,
      required: 1,
      unique: 0,
      column: 2,
    },
    {
      id: 7,
      label: "State",
      type: 1,
      required: 1,
      unique: 0,
      column: 1,
    },
    {
      id: 8,
      label: "Country",
      type: 11,
      required: 1,
      unique: 0,
      column: 2,
    },
    {
      id: 9,
      label: "Zip Code",
      type: 1,
      required: 1,
      unique: 0,
      column: 1,
    },
    {
      id: 10,
      label: "select Code",
      type: 11,
      required: 1,
      unique: 0,
      column: 2,
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
    },
    {
      id: 13,
      label: "Color",
      type: 15,
      required: 1,
      unique: 0,
      column: 1,
    },
    {
      id: 14,
      label: "range",
      type: 16,
      required: 1,
      unique: 0,
      column: 2,
    },
    {
      id: 15,
      label: "date",
      type: 21,
      required: 1,
      unique: 0,
      column: 1,
    },
    {
      id: 16,
      label: "time",
      type: 22,
      required: 1,
      unique: 0,
      column: 2,
    },
    {
      id: 17,
      label: "datetime",
      type: 23,
      required: 1,
      unique: 0,
      column: 1,
    },
    {
      id: 18,
      label: "file",
      type: 32,
      required: 1,
      unique: 0,
      column: 2,
    },
    {
      id: 19,
      label: "image",
      type: 31,
      required: 1,
      unique: 0,
      column: 1,
    },
    {
      id: 20,
      label: "signature",
      type: 33,
      required: 1,
      unique: 0,
      column: 2,
    },
    {
      id: 21,
      label: "textarea",
      type: 41,
      required: 1,
      unique: 0,
      column: 1,
    },
  ] as any);

  const [activeElement, setActiveElement] = React.useState({} as any);

  React.useEffect(() => {}, []);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 10 },
    })
  );

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
          }
        }}
        onDragEnd={(e: any) => {
          const { active, over } = e;
        }}
      >
        <div className="form-sec-cnt">
          <div className="form-sec">
            <ComponentsContainer />
            <FormWorkbenchCnt form={form} />
          </div>
        </div>
        <DragOverlay dropAnimation={null} className="drag-overlay">
          {activeElement && (
            <div className="drag-overlay-item">
              <ComponentsElements id="active" data={activeElement} />
            </div>
          )}
        </DragOverlay>
      </DndContext>
    </div>
  );
}
