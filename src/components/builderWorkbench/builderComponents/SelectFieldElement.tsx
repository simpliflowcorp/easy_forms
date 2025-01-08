import React from "react";

type Props = {
  data: any;
};

const SelectFieldElement = (props: Props) => {
  return (
    <span className="form-field-select-element-input">
      <i className="select-element-input-icon ic-caret-down-fill"></i>
    </span>
  );
};

export default SelectFieldElement;
