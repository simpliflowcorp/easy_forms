"use client";
import PrimaryButton from "@/components/buttons/PrimaryButton";
import { useLanguageStore } from "@/store/store";
import { useRouter } from "next/navigation";
import * as React from "react";
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

export interface IDndPageProps {
  type: string;
  action: (data: any) => void;
  forms: any;
  form: any;
  setForm: (data: any) => void;
  setForms: (data: any) => void;
  resetBtn?: number;
}

export default function DndPage(props: IDndPageProps) {
  const lang = useLanguageStore((state) => state.language);
  const router = useRouter();
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
            <DynamicElement
              isPublish={false}
              openElementProps={() => {}}
              data={activeElement}
            />
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
    const newForm = props.forms.map((el: any) => {
      if (el.elementId === element.elementId) {
        return element;
      }
      return el;
    });
    props.setForms(newForm);
  };

  const changeElementColumn = (element: any, column: number) => {
    const newForm = props.forms.map((el: any) => {
      if (el.elementId === element.elementId) {
        return { ...element, column: column };
      }
      return el;
    });
    props.setForms(newForm);
  };

  const dragEndHandeler = (e: any) => {
    const { active, over } = e;
    const activeId = active.id;

    if (over === null) return;
    const overId = over.id;
    const overType = over.data.current.type;
    if (activeId === overId) return;
    props.setForms((items: any) => {
      const oldIndex = items.indexOf(active.data.current.comp);
      const newIndex = items.indexOf(over.data.current.comp);

      let arryMoveVar = arrayMove(items, oldIndex, newIndex);
      return arryMoveVar;
    });

    if (activeElementType === "component") {
      let id = active.id;
      props.setForms((item: any) => {
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
              { id: 1, label: "Option 1", value: "Option 1" },
              { id: 2, label: "Option 2", value: "Option 2" },
              { id: 3, label: "Option 3", value: "Option 3" },
            ],
          };
        }

        if (addedElementCountRef.current === newElementCountRef.current) {
          props.setForms((items: any) => {
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
    props.setForm(data);
  };

  const deleteElement = (element: any) => {
    props.setForms((items: any) => {
      let newItems = items.filter(
        (e: any) => e.elementId !== element.elementId
      );
      return newItems;
    });
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

            <SecondaryButton
              label={"draft"}
              // resetBtn={resetBtn}
              action={() => props.action(0)}
            />

            <PrimaryButton
              label={"save"}
              // resetBtn={resetBtn}
              action={() => props.action(1)}
            />
          </div>
        </div>
      </div>

      <DndContext
        sensors={sensors}
        key={dndKey} // This
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
            <ComponentsContainer
              openComponentsSection={openComponentsSection}
              setOpenComponentsSection={setOpenComponentsSection}
            />

            <FormWorkbenchCnt
              form={props.forms}
              openElementProps={openElementProps}
              deleteElement={deleteElement}
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
                formPropertise={props.form}
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
