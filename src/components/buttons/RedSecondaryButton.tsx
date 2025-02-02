"use client";

import { useLanguageStore } from "@/store/store";
import * as React from "react";

export interface IRedSecondaryButtonProps {
  label: string;
  action: () => void;
  isDisabled?: boolean;
}

export default function RedSecondaryButton(props: IRedSecondaryButtonProps) {
  const lang = useLanguageStore((state) => state.language);

  return (
    <div
      className={
        props.isDisabled
          ? "red-secondary-button disabled-btn"
          : "red-secondary-button"
      }
      onClick={() => props.action()}
    >
      <span>{lang[props.label]}</span>
    </div>
  );
}
