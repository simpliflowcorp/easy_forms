import React from "react";

type Props = {
  data: any;
};

const RadioFieldElement = (props: Props) => {
  return (
    <div className="checkbox-switch-options-cnt">
      {props.data.options.map((option: any, index: number) => {
        return (
          <div className="radio-switch" key={index}>
            <input
              disabled
              type="radio"
              id={"radio-" + index}
              name={"radio-" + option.label}
              value={option.value}
            />
            <label htmlFor={"weekday-" + index}>{option.label}</label>
          </div>
        );
      })}
    </div>
  );
};

export default RadioFieldElement;
