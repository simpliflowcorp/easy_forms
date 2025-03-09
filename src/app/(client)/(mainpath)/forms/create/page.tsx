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
  ] as any);

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

  return (
    <DndPage
      type="create_form"
      action={createForm}
      forms={forms}
      form={form}
      setForms={setForms}
      setForm={setForm}
    />
  );
}
