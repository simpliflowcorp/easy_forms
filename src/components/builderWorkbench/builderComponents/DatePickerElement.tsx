import React from "react";

type Props = {
  data: any;
};

const DatePickerElement = (props: Props) => {
  return (
    <div className="form-field-element">
      <div className="form-field-element-label">
        {props.data.label}
        <i className=" form-field-element-options ic-three-dots-vertical"></i>
      </div>
      <label className="date-picker">
        <input
          type="date"
          className=" date-picker-input form-field-color-element-input"
        />
      </label>
    </div>
  );
};

export default DatePickerElement;
