"use client";

import { useLanguageStore } from "@/store/store";
import * as React from "react";

export interface IGreenPrimaryActionButtonProps {
  label: string;
  action: () => void;
}

export default function GreenPrimaryActionButton(
  props: IGreenPrimaryActionButtonProps
) {
  const lang = useLanguageStore((state) => state.language);

  return (
    <div className="green-primary-button" onClick={() => props.action()}>
      <span>{lang[props.label]}</span>
    </div>
  );
}
