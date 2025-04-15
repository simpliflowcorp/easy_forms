"use client";

import { useLanguageStore } from "@/store/store";
import * as React from "react";

export interface IToogleSwitchProps {
  label: string;
  action: () => void;
  value: boolean;
}

export default function ToogleSwitch(props: IToogleSwitchProps) {
  const lang = useLanguageStore((state) => state.language);
  const [uid, setUid] = React.useState(Math.random());
  const [checked, setChecked] = React.useState(props.value);

  // React.useEffect(() => {
  //   if (props.reset !== 0) {
  //     if (props.value === "") {
  //       setIsNotEmpty(true);
  //     } else {
  //       setIsValid(props.isValid);
  //     }
  //   }
  // }, [props.value, props.isValid, props.reset]);

  return (
    <div className="toogle-switch">
      <span>{lang[props.label]}</span>
      <input
        type="checkbox"
        id={"switch" + uid}
        onChange={() => {
          setChecked(!checked);
          props.action();
        }}
        checked={checked}
      />
      <label htmlFor={"switch" + uid}>Toggle</label>
    </div>
  );
}
