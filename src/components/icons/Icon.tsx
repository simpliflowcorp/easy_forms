"use client";

import { useLanguageStore } from "@/store/store";
import * as React from "react";

export interface IIconProps {
  icon: string;
  action: () => void;
}

export default function Icon(props: IIconProps) {
  const [isClicked, setIsClicked] = React.useState(false);
  const lang = useLanguageStore((state) => state.language);

  React.useEffect(() => {
    if (isClicked) {
      setTimeout(() => {
        setIsClicked(false);
      }, 2000);
    }
  }, [isClicked]);

  return (
    <div className={"simple-icon"} onClick={() => props.action()}>
      <span className={"ic-" + props.icon}></span>
    </div>
  );
}
