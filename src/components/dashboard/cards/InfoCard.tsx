import React from "react";

type Props = {
  label: string;
  count: Number;
};

const InfoCard = (props: Props) => {
  return (
    <div className="info-card-cnt">
      <div className="info-card-text">{props.label}</div>
      <div className="info-card-count">{props.count + ""}</div>
    </div>
  );
};

export default InfoCard;
