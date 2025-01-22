"use client";

import { useLanguageStore } from "@/store/store";
import * as React from "react";

export interface IPromotionButtonProps {
  label: string;
  action: () => void;
}

export default function PromotionButton(props: IPromotionButtonProps) {
  const lang = useLanguageStore((state) => state.language);

  return (
    <div className="promotion-button" onClick={() => props.action()}>
      <span>{lang[props.label]}</span>
    </div>
  );
}
