import React from "react";

type Props = {
  data: any;
};

const ColorPickerElement = (props: Props) => {
  return (
    <div className="">
      <label className=" color-picker ic-pen">
        <input
          disabled
          type="color"
          className=" color-picker-input form-field-color-element-input"
        />
      </label>
    </div>
  );
};

export default ColorPickerElement;
