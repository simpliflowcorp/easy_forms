import { useLanguageStore } from "@/store/store";
import { useDroppable } from "@dnd-kit/core";
import React from "react";

type Props = {};

const FormWorkbench = (props: Props) => {
  const { setNodeRef } = useDroppable({
    id: "workbench",
    data: {
      type: "workbench",
    },
  });
  const lang = useLanguageStore((state) => state.language);

  React.useEffect(() => {}, []);

  return (
    <div ref={setNodeRef} className="form-workbench">
      <div className="workbench-cnt">
        <div className="workbench"></div>
      </div>
    </div>
  );
};

export default FormWorkbench;
