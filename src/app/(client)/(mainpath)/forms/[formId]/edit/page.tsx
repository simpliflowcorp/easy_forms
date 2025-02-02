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
  const [resetBtn, setResetBtn] = React.useState(0);

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

  console.log(form_Id);

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
        console.log("aaa");

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
    }
  };

  const dragOverHandeler = (e: any) => {
    const { active, over } = e;
    if (!active || !over) return;

    if (over.data.current?.comp) {
      if (activeElementType === "component") {
        let newElement = {
          id: active.id,
          elementId: active.id,
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
          console.log(active.data.current.comp);

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
    return (
      <div className="form-cnt">
        <div className="form-header">
          <div className="left">
            <div className="form-sec-header-left">
              <span className="header-indicator">/</span>
              <span className="header-text">{lang.edit_form}</span>
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
                action={() => router.push("/forms/" + formID)}
              />

              <PrimaryButton label={"save"} action={() => updateForm()} />
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
}
