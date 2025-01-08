import React from "react";

type Props = {
  data: any;
};

const RangePickerElement = (props: Props) => {
  return (
    <div className="">
      <label className=" color-picker">
        <input
          disabled
          type="range"
          className=" color-picker-input form-field-color-element-input"
        />
      </label>
    </div>
  );
};

export default RangePickerElement;
