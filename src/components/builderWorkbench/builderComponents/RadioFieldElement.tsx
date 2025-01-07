import React from "react";

type Props = {
  data: any;
};

const RadioFieldElement = (props: Props) => {
  return (
    <div className="form-field-element">
      <div className="form-field-element-label">
        {props.data.label}
        <i className=" form-field-element-options ic-three-dots-vertical"></i>
      </div>
      <div className="checkbox-switch-options-cnt">
        {props.data.options.map((option: any, index: number) => {
          return (
            <div className="radio-switch" key={index}>
              <input
                disabled
                type="radio"
                id={"weekday-" + index}
                name={"weekday-" + index}
                value={option.value}
              />
              <label htmlFor={"weekday-" + index}>{option.label}</label>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default RadioFieldElement;
