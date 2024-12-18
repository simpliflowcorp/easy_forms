import React from "react";

type Props = {
  data: any;
};

const CheckboxFieldElement = (props: Props) => {
  return (
    <div className="form-field-element-cnt">
      <div className="form-field-element">
        <div className="form-field-element-label">
          {props.data.label}
          <i className=" form-field-element-options ic-three-dots-vertical"></i>
        </div>
        <div className="checkbox-switch">
          <input
            type="checkbox"
            id="weekday-2"
            name="weekday-2"
            value="Saturday"
          />
          <label htmlFor="weekday-2">Saturday</label>
        </div>

        <span className="form-field-checkbox-element-input"></span>
      </div>
    </div>
  );
};

export default CheckboxFieldElement;
