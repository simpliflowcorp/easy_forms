"use client";

import * as React from "react";
import { blurCheck, validationCheck } from "../../helper/validationCheck";
import { useLanguageStore } from "@/store/store";
import ErroTextCnt from "./components/ErrorTextCnt";

export interface ITextFieldInputProps {
  label: string;
  value: string;
  updateValue: (value: string) => void;
  updateIsValid: (value: boolean) => void;
  isValid: boolean;
  isRequired: boolean;
  reset: number;
}

export default function TextFieldInput(props: ITextFieldInputProps) {
  const [isValid, setIsValid] = React.useState(true);
  const [IsNotEmpty, setIsNotEmpty] = React.useState(false);
  const [value, setValue] = React.useState(props.value as string);
  const lang = useLanguageStore((state) => state.language);
  const [uid, setUid] = React.useState(Math.random());

  React.useEffect(() => {
    if (props.reset !== 0) {
      if (props.value === "") {
        setIsNotEmpty(true);
      } else {
        setIsValid(props.isValid);
      }
    }
  }, [props.value, props.isValid, props.reset]);

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
          autoComplete="off"
          type="text"
          id={"text" + uid}
          className={!isValid || IsNotEmpty ? "error-input" : ""}
          value={value}
          // onChange={(e) => setValue(e.target.value)}
          onInput={(e) => {
            setValue(e.currentTarget.value);
          }}
          onBlur={() => {
            blurCheck(value, props, setIsValid, setIsNotEmpty, "text");
          }}
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
