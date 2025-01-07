import React from "react";

type Props = {
  data: any;
};

const SelectFieldElement = (props: Props) => {
  return (
    <div className="form-field-element">
      <div className="form-field-element-label">
        {props.data.label}
        <i className=" form-field-element-options ic-three-dots-vertical"></i>
      </div>
      <span className="form-field-select-element-input">
        <i className="select-element-input-icon ic-caret-down-fill"></i>
      </span>
    </div>
  );
};

export default SelectFieldElement;
