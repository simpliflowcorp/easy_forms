import { useLanguageStore } from "@/store/store";
import { useDroppable } from "@dnd-kit/core";
import React from "react";
import DynamicElement from "./builderComponents/DynamicElement";

type Props = {
  form: any;
  id: string;
  openElementProps: any;
  deleteElement: (elementId: number) => void;
};

const FormWorkbench = (props: Props) => {
  const { setNodeRef } = useDroppable({
    id: props.id + "_" + "workbench",
    data: {
      type: props.id + "_" + "workbench",
      comp: {
        column: props.id === "left" ? 1 : 2,
      },
    },
  });

  const lang = useLanguageStore((state) => state.language);

  React.useEffect(() => {}, []);

  return (
    <div ref={setNodeRef} className="workbench">
      {props.form
        .filter(
          (element: any) =>
            (element.column === 1 && props.id === "left") ||
            (props.id === "right" && element.column === 2)
        )
        .map((element: any, index: number) => {
          return (
            <DynamicElement
              openElementProps={props.openElementProps}
              key={index}
              data={element}
              deleteElement={props.deleteElement}
            />
          );
        })}
    </div>
  );
};

export default FormWorkbench;
