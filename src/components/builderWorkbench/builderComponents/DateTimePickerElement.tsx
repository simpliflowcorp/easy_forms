import React from "react";

type Props = {
  data: any;
};

const DateTimePickerElement = (props: Props) => {
  return (
    <label className="date-picker">
      <input disabled type="datetime-local" className=" date-picker-input" />
    </label>
  );
};

export default DateTimePickerElement;
