"use client";

import * as React from "react";
import { blurCheck, validationCheck } from "../../helper/validationCheck";
import { useLanguageStore } from "@/store/store";
import ErroTextCnt from "./components/ErrorTextCnt";

export interface ICheckboxInputProps {
  label: string;
  value: any;
  updateValue: (value: string) => void;
  updateIsValid: (value: boolean) => void;
  isValid: boolean;
  isRequired: boolean;
  reset: number;
  options: { label: string; value: string }[];
}

export default function CheckboxInput(props: ICheckboxInputProps) {
  const [isValid, setIsValid] = React.useState(true);
  const [IsNotEmpty, setIsNotEmpty] = React.useState(false);
  const [value, setValue] = React.useState<string[]>(props.value as string[]);
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

  const handleCheckboxChange = (option: string) => {
    let values = [...value];
    let newValues = values.includes(option)
      ? values.filter((item: any) => item !== option) // Remove if already selected
      : [...values, option];
    return newValues;
  };

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
            <div className="checkbox-switch" key={index}>
              <input
                type="checkbox"
                id={props.label + "-" + uid + "-" + index}
                name={props.label + "-" + uid + "-" + index}
                value={option.value}
                checked={value.includes(option.value)}
                onChange={(e) => {
                  let values = handleCheckboxChange(e.target.value);
                  setValue([...values]);
                  console.log(values);

                  blurCheck(values, props, setIsValid, setIsNotEmpty, "array");
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
