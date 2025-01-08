import React from "react";

type Props = {
  data: any;
};

const TimePickerElement = (props: Props) => {
  return (
    <label className="date-picker">
      <input disabled type="time" className=" date-picker-input" />
    </label>
  );
};

export default TimePickerElement;
