import React from "react";

type Props = {
  data: any;
};

const TimePickerElement = (props: Props) => {
  return (
    <div className="form-field-element">
      <div className="form-field-element-label">
        {props.data.label}
        <i className=" form-field-element-options ic-three-dots-vertical"></i>
      </div>
      <label className="date-picker">
        <input disabled type="time" className=" date-picker-input" />
      </label>
    </div>
  );
};

export default TimePickerElement;
