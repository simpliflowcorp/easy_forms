"use client";

import * as React from "react";
import { blurCheck, validationCheck } from "../../helper/validationCheck";
import { useLanguageStore } from "@/store/store";
import ErroTextCnt from "./components/ErrorTextCnt";

export interface ITimeInputFieldProps {
  label: string;
  value: string;
  updateValue: (value: string) => void;
  updateIsValid: (value: boolean) => void;
  isValid: boolean;
  reset: number;
  isRequired: boolean;
  isDisableOldDate?: boolean;
}

export default function TimeInputFieldInput(props: ITimeInputFieldProps) {
  const [isValid, setIsValid] = React.useState(true);
  const [IsNotEmpty, setIsNotEmpty] = React.useState(false);
  const [value, setValue] = React.useState(props.value as string);
  const lang = useLanguageStore((state) => state.language);
  const [uid, setUid] = React.useState(Math.random());
  const [disableOldDate, setDisableOldDate] = React.useState(
    props.isDisableOldDate
  );
  const [minValue, setMinValue] = React.useState("");

  React.useEffect(() => {
    if (props.reset !== 0) {
      if (props.value === "") {
        setIsNotEmpty(true);
      } else {
        setIsValid(props.isValid);
      }
    }
  }, [props.value, props.isValid, props.reset]);

  React.useEffect(() => {
    if (disableOldDate) {
      setMinValue(new Date().toISOString().split("T")[0]);
    }
  }, [disableOldDate]);

  return (
    <>
      <div className="input-cnt">
        <label htmlFor={"text" + uid}>
          {props.label}{" "}
          <span className="required-asterisk">
            {props.isRequired ? "*" : ""}
          </span>
        </label>

        <input
          type="time"
          id={"date" + uid}
          className={!isValid || IsNotEmpty ? "error-input" : ""}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
          }}
          onBlur={() => {
            blurCheck(value, props, setIsValid, setIsNotEmpty, "date");
          }}
          min={minValue}
        />

        <ErroTextCnt
          isRequired={props.isRequired}
          isValid={!isValid}
          IsNotEmpty={IsNotEmpty}
        />
      </div>
    </>
  );
}
