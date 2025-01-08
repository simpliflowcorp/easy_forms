import React from "react";

type Props = {
  data: any;
};

const DatePickerElement = (props: Props) => {
  return (
    <label className="date-picker">
      <input
        type="date"
        className=" date-picker-input form-field-color-element-input"
      />
    </label>
  );
};

export default DatePickerElement;
