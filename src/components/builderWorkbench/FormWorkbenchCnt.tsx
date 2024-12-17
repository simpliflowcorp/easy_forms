import React from "react";
import FormWorkbench from "./FormWorkbench";

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
