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
import { errorHandler } from "@/helper/errorHandler";
import { stat } from "fs";
import { successHandler } from "@/helper/successHandler";
import DndPage from "@/components/dndPage/DndPage";
export interface IformsProps {}

export default function forms(props: IformsProps) {
  const lang = useLanguageStore((state) => state.language);
  const router = useRouter();

  const [isActive, setIsActive] = React.useState("all" as string);
  const [gotData, setGotData] = React.useState(false);
  const [data, setData] = React.useState({} as any);

  const [form, setForm] = React.useState({
    name: "",
    description: "",
    expiry: "",
  } as any);

  const [forms, setForms] = React.useState([
    {
      elementId: 1,
      label: "First Name",
      type: 1,
      required: true,
      unique: false,
      column: 1,
      position: 1,
    },
    {
      elementId: 13,
      label: "Check",
      type: 13,
      required: true,
      unique: false,
      column: 1,
      options: [
        { id: 1, label: "Option 1", value: "Option 1" },
        { id: 2, label: "Option 2", value: "Option 2" },
        { id: 3, label: "Option 3", value: "Option 3" },
      ],
      position: 6,
    },
    {
      elementId: 12,
      label: "Radio",
      type: 14,
      required: true,
      unique: false,
      column: 2,
      options: [
        { id: 1, label: "Option 1", value: "Option 1" },
        { id: 2, label: "Option 2", value: "Option 2" },
        { id: 3, label: "Option 3", value: "Option 3" },
      ],
      position: 6,
    },
    {
      elementId: 11,
      label: "Select",
      type: 11,
      required: true,
      unique: false,
      column: 2,
      options: [
        { id: 1, label: "Option 1", value: "Option 1" },
        { id: 2, label: "Option 2", value: "Option 2" },
        { id: 3, label: "Option 3", value: "Option 3" },
      ],
      position: 6,
    },
  ] as any);

  const [activeElement, setActiveElement] = React.useState({} as any);
  const [activeElementType, setActiveElementType] = React.useState(
    "" as string
  );

  const [resetBtn, setResetBtn] = React.useState(0);
  const [dndKey, setDndKey] = React.useState(0);

  const newElementCountRef = React.useRef(101);
  const addedElementCountRef = React.useRef(101);

  const [elementPropertise, setElementPropertise] = React.useState({} as any);
  const [openElementPropertise, setOpenElementPropertise] =
    React.useState(false);
  const [openFormPropertise, setOpenFormPropertise] = React.useState(true);

  const [openComponentsSection, setOpenComponentsSection] = React.useState(
    "base_components" as string
  );

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
      if (el.elementId === element.elementId) {
        return element;
      }
      return el;
    });
    setForms(newForm);
  };

  const changeElementColumn = (element: any, column: number) => {
    const newForm = forms.map((el: any) => {
      if (el.elementId === element.elementId) {
        return { ...element, column: column };
      }
      return el;
    });
    setForms(newForm);
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
            if (e.elementId === id) {
              return { ...e, elementId: newElementCountRef.current };
            } else {
              return e;
            }
          }),
        ];
        return newform;
      });
      newElementCountRef.current++;
      setDndKey((prev) => prev + 1);
    }

    setActiveElement({} as any);
    setActiveElementType("");
  };

  const createForm = async (form_status: number) => {
    if (form.name && form.expiry && forms.length > 0) {
      try {
        const data = {
          name: form.name,
          description: form.description,
          expiry: form.expiry,
          elements: forms,
          status: form_status,
        };
        const res = await axios.post("/api/form/create", data);
        if (res.status === 200) {
          successHandler(res, lang);

          router.push("/forms/" + res.data.data.formId);
        }
      } catch (error: any) {
        setResetBtn((p) => p + 1);
        errorHandler(error, lang);
      }
    } else {
      setResetBtn((p) => p + 1);
      errorHandler(
        {
          response: {
            data: { message: "form_name_and_expiry_cannot_be_empty" },
          },
        },
        lang
      );
    }
  };

  return <DndPage type="create_form" />;
}
