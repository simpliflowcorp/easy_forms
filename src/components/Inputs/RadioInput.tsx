"use client";

import * as React from "react";
import { blurCheck, validationCheck } from "../../helper/validationCheck";
import { useLanguageStore } from "@/store/store";
import ErroTextCnt from "./components/ErrorTextCnt";

export interface IRadioInputProps {
  label: string;
  value: string;
  updateValue: (value: string) => void;
  updateIsValid: (value: boolean) => void;
  isValid: boolean;
  isRequired: boolean;
  reset: number;
  options: { label: string; value: string }[];
}

export default function RadioInput(props: IRadioInputProps) {
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

  console.log(value);

  return (
    <>
      <div className="input-cnt">
        <label htmlFor={"text" + uid}>
          {props.label}{" "}
          <span className="required-asterisk">
            {props.isRequired ? "*" : ""}
          </span>
        </label>
        {props.options.map((option: any, index: number) => {
          return (
            <div className="radio-switch" key={index}>
              <input
                type="radio"
                id={props.label + "-" + uid + "-" + index}
                name={props.label + "-" + uid}
                value={option.value}
                onChange={(e) => {
                  setValue(e.target.value);
                  blurCheck(
                    e.target.value,
                    props,
                    setIsValid,
                    setIsNotEmpty,
                    "text"
                  );
                }}
              />
              <label htmlFor={props.label + "-" + uid + "-" + index}>
                {option.label}
              </label>
            </div>
          );
        })}

        <ErroTextCnt
          isRequired={props.isRequired}
          isValid={!isValid}
          IsNotEmpty={IsNotEmpty}
        />
      </div>
    </>
  );
}
