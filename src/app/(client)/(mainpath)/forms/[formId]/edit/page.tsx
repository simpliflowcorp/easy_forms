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
import ElementPropertise from "@/components/builderWorkbench/ElementPropertise";
import SecondaryButton from "@/components/buttons/SecondaryButton";
import IconButton from "@/components/buttons/IconButton";
import FormPropertise from "@/components/builderWorkbench/FormPropertise";
export interface IformsProps {}

export default function forms(props: IformsProps) {
  const lang = useLanguageStore((state) => state.language);
  const router = useRouter();

  const [isActive, setIsActive] = React.useState("all" as string);
  const [gotData, setGotData] = React.useState(false);
  const [data, setData] = React.useState({} as any);

  const [form, setForm] = React.useState({
    name: "Form Name",
    description: "Form Description",
    expiry: new Date().toISOString().split("T")[0],
  } as any);

  const [forms, setForms] = React.useState([
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
      options: [
        { id: 1, label: "Option 1", value: 0 },
        { id: 2, label: "Option 2", value: 0 },
        { id: 3, label: "Option 3", value: 0 },
      ],
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
      options: [
        { id: 1, label: "Option 1", value: 0 },
        { id: 2, label: "Option 2", value: 0 },
        { id: 3, label: "Option 3", value: 0 },
      ],
    },
    {
      id: 11,
      label: "Check",
      type: 13,
      required: 1,
      unique: 0,
      column: 1,
      options: [
        { id: 1, label: "Option 1", value: 0 },
        { id: 2, label: "Option 2", value: 0 },
        { id: 3, label: "Option 3", value: 0 },
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
        { id: 1, label: "Option 1", value: 0 },
        { id: 2, label: "Option 2", value: 0 },
        { id: 3, label: "Option 3", value: 0 },
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

  const [elementPropertise, setElementPropertise] = React.useState({} as any);
  const [openElementPropertise, setOpenElementPropertise] =
    React.useState(false);
  const [openFormPropertise, setOpenFormPropertise] = React.useState(false);
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
            <DynamicElement openElementProps={() => {}} data={activeElement} />
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
    const newForm = forms.map((el: any) => {
      if (el.id === element.id) {
        return element;
      }
      return el;
    });
    setForm(newForm);
  };

  const changeElementColumn = (element: any, column: number) => {
    const newForm = forms.map((el: any) => {
      if (el.id === element.id) {
        return { ...element, column };
      }
      return el;
    });
    setForm(newForm);
  };

  const dragEndHandeler = (e: any) => {
    const { active, over } = e;
    const activeId = active.id;

    if (over === null) return;
    const overId = over.id;
    const overType = over.data.current.type;
    if (activeId === overId) return;
    setForms((items: any) => {
      const oldIndex = items.indexOf(active.data.current.comp);
      const newIndex = items.indexOf(over.data.current.comp);

      let arryMoveVar = arrayMove(items, oldIndex, newIndex);
      return arryMoveVar;
    });

    if (activeElementType === "component") {
      let id = active.id;
      setForms((item: any) => {
        let newform = [
          ...item.map((e: any) => {
            if (e.id === id) {
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

    if (over.data.current?.comp) {
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

        if (
          activeElement.type === 11 ||
          activeElement.type === 12 ||
          activeElement.type === 13 ||
          activeElement.type === 14
        ) {
          newElement = {
            ...newElement,
            options: [
              { id: 1, label: "Option 1", value: 0 },
              { id: 2, label: "Option 2", value: 0 },
              { id: 3, label: "Option 3", value: 0 },
            ],
          };
        }

        if (addedElementCountRef.current === newElementCountRef.current) {
          setForms((items: any) => {
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

  const openElementProps = (element: any) => {
    setElementPropertise(element);
    setOpenElementPropertise(true);
  };

  const updateFormData = (data: any) => {
    setForm(data);
  };

  const createForm = () => {
    let form = {
      name: "form name",
      description: "form description",
      elements: [],
    };
  };

  return (
    <div className="form-cnt">
      <div className="form-header">
        <div className="left">
          <div className="form-sec-header-left">
            <span className="header-indicator">/</span>
            <span className="header-text">{lang.create_form}</span>
          </div>
        </div>

        <div className="right">
          <div className="btn-cnt">
            <IconButton
              icon="gear"
              action={() => setOpenFormPropertise(true)}
            />

            <SecondaryButton
              label={"cancel"}
              action={() => router.push("/forms")}
            />

            <PrimaryButton
              label={"save"}
              action={() => router.push("/forms/create")}
            />
          </div>
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

            <FormWorkbenchCnt
              form={forms}
              openElementProps={openElementProps}
            />
            {openElementPropertise && (
              <ElementPropertise
                elementPropertise={elementPropertise}
                close={() => setOpenElementPropertise(false)}
                updateFormElement={updateFormElement}
              />
            )}

            {openFormPropertise && (
              <FormPropertise
                formPropertise={form}
                close={() => setOpenFormPropertise(false)}
                updateFormElement={updateFormData}
              />
            )}
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
