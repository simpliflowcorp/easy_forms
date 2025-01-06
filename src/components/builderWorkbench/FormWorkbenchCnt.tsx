import React from "react";
import FormWorkbench from "./FormWorkbench";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";

type Props = {
  form: any;
};

const FormWorkbenchCnt = (props: Props) => {
  return (
    <div className="form-workbench">
      <div className="workbench-cnt">
        <SortableContext
          items={props.form
            .filter((element: any) => element.column === 1)
            .map((element: any) => element.id)}
          strategy={verticalListSortingStrategy}
        >
          <FormWorkbench id="left" form={props.form} />
        </SortableContext>
        <SortableContext
          items={props.form
            .filter((element: any) => element.column === 2)
            .map((element: any) => element.id)}
          strategy={verticalListSortingStrategy}
        >
          <FormWorkbench id="right" form={props.form} />
        </SortableContext>
      </div>
    </div>
  );
};

export default FormWorkbenchCnt;
