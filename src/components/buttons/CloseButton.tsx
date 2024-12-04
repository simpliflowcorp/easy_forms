import React from "react";

type Props = {
  close: () => void;
};

const CloseButton = (props: Props) => {
  return (
    <div className="close-button">
      <span onClick={() => props.close()} className={"ic-x-lg"}></span>
    </div>
  );
};

export default CloseButton;
