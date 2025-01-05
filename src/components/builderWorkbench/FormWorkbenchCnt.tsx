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
        <FormWorkbench id="left" form={props.form} />
        <FormWorkbench id="right" form={props.form} />
      </div>
    </div>
  );
};

export default FormWorkbenchCnt;
