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
import { cloneDeep } from "@/helper/cloneDeep";
import { successHandler } from "@/helper/successHandler";
import { errorHandler } from "@/helper/errorHandler";
import DndPage from "@/components/dndPage/DndPage";
export interface IformsProps {}

export default function forms(props: IformsProps) {
  const lang = useLanguageStore((state) => state.language);
  const router = useRouter();

  const [isActive, setIsActive] = React.useState("all" as string);
  const [gotData, setGotData] = React.useState(false);
  const [data, setData] = React.useState({} as any);

  const [form, setForm] = React.useState({} as any);
  const [formBkp, setFormBkp] = React.useState({} as any);
  const [forms, setForms] = React.useState([] as any);
  const [formsBkp, setFormsBkp] = React.useState([] as any);

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

  const [formID, setFormID] = React.useState("" as string);
  const [form_Id, setForm_Id] = React.useState("" as string);

  React.useEffect(() => {
    setFormID(window.location.pathname.split("/")[2] + "");
    getFormData();
  }, []);

  const getFormData = async () => {
    try {
      const res = await axios.get("/api/form/read");
      if (res.status === 200) {
        // setFormData(res.data.data);
        setForm_Id(res.data.data._id);
        let oldElements = cloneDeep(res.data.data.elements);
        setForms(oldElements);
        setFormsBkp(res.data.data.elements);
        setForm(
          (prev: any) =>
            ({
              ...prev,
              name: res.data.data.name,
              description: res.data.data.description,
              expiry: new Date(res.data.data.expiry)
                .toISOString()
                .split("T")[0],
            } as any)
        ); //res.data.data);
        setFormBkp(
          (prev: any) =>
            ({
              ...prev,
              name: res.data.data.name,
              description: res.data.data.description,
              expiry: new Date(res.data.data.expiry)
                .toISOString()
                .split("T")[0],
            } as any)
        ); //res.data.data);
        setGotData(true);
      }
    } catch (error: any) {
      console.log(error);
    }
  };

  const updateForm = async () => {
    let changes = {};
    if (JSON.stringify(form) !== JSON.stringify(formBkp)) {
      if (form.name !== formBkp.name) {
        changes = {
          ...changes,
          name: form.name,
        };
      }
      if (form.description !== formBkp.description) {
        changes = {
          ...changes,
          description: form.description,
        };
      }
      if (form.expiry !== formBkp.expiry) {
        changes = {
          ...changes,
          expiry: form.expiry,
        };
      }
    }
    if (JSON.stringify(forms) !== JSON.stringify(formsBkp)) {
      changes = {
        ...changes,
        elements: forms,
      };
    }

    if (Object.keys(changes).length > 0) {
      changes = {
        ...changes,
        _id: form_Id,
      };
      try {
        const res = await axios.post("/api/form/update", changes);
        if (res.status === 200) {
          successHandler(res, lang);
          router.push("/forms/" + formID);
        }
      } catch (error: any) {
        setResetBtn((p) => p + 1);
        errorHandler(error, lang);
      }
    } else {
      router.push("/forms/" + formID);
      errorHandler(
        {
          response: {
            data: { message: "no_changes_saved" },
          },
        },
        lang
      );
    }
  };

  if (!gotData) {
    return <div className="accent-line-loader"></div>;
  } else {
    return <DndPage type="edit_form" action={updateForm} />;
  }
}
