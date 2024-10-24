"use client";

import { useLanguageStore } from "@/store/store";
import * as React from "react";

export interface IPrimaryActionButtonProps {
  label: string;
  resetBtn: number;
  action: () => void;
}

export default function PrimaryActionButton(props: IPrimaryActionButtonProps) {
  const lang = useLanguageStore((state) => state.language);
  const [isClicked, setIsClicked] = React.useState(false);

  React.useEffect(() => {
    setIsClicked(false);
  }, [props.resetBtn]);

  return (
    <div
      className={
        isClicked ? "primary-action-button inactive" : "primary-action-button"
      }
      onClick={() => {
        setIsClicked(true);
        props.action();
      }}
    >
      <p className={isClicked ? "three-dots-pop-loader" : ""}>
        {isClicked ? "" : lang[props.label]}
      </p>
    </div>
  );
}
