import React from "react";

type Props = {
  data: any;
};

const TextFieldElement = (props: Props) => {
  return (
    <div className="form-field-element">
      <div className="form-field-element-label">
        {props.data.label}
        <i className="form-field-element-options ic-three-dots-vertical"></i>
      </div>
      <span className="form-field-text-element-input"></span>
    </div>
  );
};

export default TextFieldElement;
