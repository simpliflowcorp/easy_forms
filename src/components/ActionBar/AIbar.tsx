import React from "react";

type Props = {};

const AIbar = (props: Props) => {
  return (
    <div className="ai-bar">
      <div className="ai-input-section"></div>
      <div className="ai-face">
        <div className="eye eye_left"></div>
        <div className="eye eye_right"></div>
      </div>
    </div>
  );
};

export default AIbar;
