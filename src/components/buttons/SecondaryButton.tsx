"use client";

import { useLanguageStore } from "@/store/store";
import * as React from "react";

export interface ISecondaryButtonProps {
  label: string;
  action: () => void;
  isDisabled?: boolean;
}

export default function SecondaryButton(props: ISecondaryButtonProps) {
  const lang = useLanguageStore((state) => state.language);

  return (
    <div
      className={
        props.isDisabled ? "secondary-button disabled-btn" : "secondary-button"
      }
      onClick={() => props.action()}
    >
      <span>{lang[props.label]}</span>
    </div>
  );
}
