import React from "react";

type Props = {
  data: any;
};

const RangePickerElement = (props: Props) => {
  return (
    <div className="form-field-element">
      <div className="form-field-element-label">
        {props.data.label}
        <i className=" form-field-element-options ic-three-dots-vertical"></i>
      </div>
      <div className="">
        <label className=" color-picker">
          <input
            disabled
            type="range"
            className=" color-picker-input form-field-color-element-input"
          />
        </label>
      </div>
    </div>
  );
};

export default RangePickerElement;
