"use client";

import { useLanguageStore } from "@/store/store";
import Image from "next/image";
import * as React from "react";

export interface IIconButtonProps {
  icon: string;
  action: () => void;
}

export default function IconButton(props: IIconButtonProps) {
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
    <div className={"icon-button"} onClick={() => props.action()}>
      <span className={"ic-" + props.icon}></span>
    </div>
  );
}
