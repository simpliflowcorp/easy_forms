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
  closestCenter,
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import ComponentsContainer from "@/components/builderWorkbench/ComponentsContainer";
import { set } from "mongoose";
import ComponentsElements from "@/components/builderWorkbench/ComponentsElements";
import FormWorkbench from "@/components/builderWorkbench/FormWorkbench";
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
      label: "Zip Code",
      type: 11,
      required: 1,
      unique: 0,
      column: 1,
    },
  ] as any);

  const [activeElement, setActiveElement] = React.useState({} as any);

  React.useEffect(() => {
    console.log(META_DATAS);
  }, []);

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
          console.log(e);
          if (e) {
            setActiveElement(e.active.data.current.comp);
          }
        }}
        onDragEnd={(e: any) => {
          const { active, over } = e;

          console.log({ active, over });
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
