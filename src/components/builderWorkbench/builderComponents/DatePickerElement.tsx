import React from "react";

type Props = {
  data: any;
};

const DatePickerElement = (props: Props) => {
  return (
    <div className="form-field-element-cnt">
      <div className="form-field-element">
        <div className="form-field-element-label">
          {props.data.label}
          <i className=" form-field-element-options ic-three-dots-vertical"></i>
        </div>
        <label className="date-picker">
          <input disabled type="date" className=" date-picker-input" />
        </label>
      </div>
    </div>
  );
};

export default DatePickerElement;
