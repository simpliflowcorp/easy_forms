"use client";

import { useLanguageStore } from "@/store/store";
import * as React from "react";

export interface IToogleSwitchProps {
  label: string;
  action: () => void;
}

export default function ToogleSwitch(props: IToogleSwitchProps) {
  const lang = useLanguageStore((state) => state.language);
  const [uid, setUid] = React.useState(Math.random());

  console.log(uid);

  return (
    <div className="toogle-switch" onClick={() => props.action()}>
      <span>{lang[props.label]}</span>
      <input type="checkbox" id={"switch" + uid} />
      <label htmlFor={"switch" + uid}>Toggle</label>
    </div>
  );
}
