"use client";

import { useLanguageStore } from "@/store/store";
import * as React from "react";

export interface ISecondaryButtonProps {
  label: string;
  action: () => void;
}

export default function SecondaryButton(props: ISecondaryButtonProps) {
  const lang = useLanguageStore((state) => state.language);

  return (
    <div className="secondary-button" onClick={() => props.action()}>
      <span>{lang[props.label]}</span>
    </div>
  );
}
