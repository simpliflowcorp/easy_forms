import React from "react";

type Props = {
  data: any;
};

const CheckboxFieldElement = (props: Props) => {
  return (
    <div className="checkbox-switch-options-cnt">
      {props.data.options.map((option: any, index: number) => {
        return (
          <div className="checkbox-switch" key={index}>
            <input
              type="checkbox"
              disabled
              id={"weekday-" + index}
              name={"weekday-" + index}
              value={option.value}
            />
            <label htmlFor={"weekday-" + index}>{option.label}</label>
          </div>
        );
      })}
    </div>
  );
};

export default CheckboxFieldElement;
