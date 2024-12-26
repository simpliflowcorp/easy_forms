import React from "react";

type Props = {
  data: any;
};

const ColorPickerElement = (props: Props) => {
  return (
    <div className="form-field-element-cnt">
      <div className="form-field-element">
        <div className="form-field-element-label">
          {props.data.label}
          <i className=" form-field-element-options ic-three-dots-vertical"></i>
        </div>
        <div className="">
          <label className=" color-picker ic-pen">
            <input
              disabled
              type="color"
              className=" color-picker-input form-field-color-element-input"
            />
          </label>
        </div>
      </div>
    </div>
  );
};

export default ColorPickerElement;
