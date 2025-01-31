"use client";

import * as React from "react";
import { blurCheck } from "../../helper/validationCheck";
import { useLanguageStore } from "@/store/store";
import ErroTextCnt from "./components/ErrorTextCnt";
import Select from "react-select";

export interface ISelectFieldInputProps {
  label: string;
  value: string;
  updateValue: (value: string) => void;
  updateIsValid: (value: boolean) => void;
  isValid: boolean;
  isRequired: boolean;
  reset: number;
  options: { label: string; value: string }[];
}

export default function SelectFieldInput(props: ISelectFieldInputProps) {
  const [isValid, setIsValid] = React.useState(true);
  const [isNotEmpty, setIsNotEmpty] = React.useState(
    props.isRequired ? Boolean(props.value) : false
  );
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

  const darkThemeStyles = {
    control: (base: any, state: { isFocused: any }) => ({
      ...base,
      backgroundColor: "#333",
      color: "#fff",
      border: state.isFocused ? "1px solid #555" : "1px solid #444",
      boxShadow: state.isFocused ? "0 0 0 1px #555" : "none",
      "&:hover": {
        border: "1px solid #555",
      },
    }),
    menu: (base: any) => ({
      ...base,
      backgroundColor: "#222",
      color: "#fff",
    }),
    menuList: (base: any) => ({
      ...base,
      backgroundColor: "#222",
      color: "#fff",
      "::-webkit-scrollbar": {
        width: "8px",
      },
      "::-webkit-scrollbar-track": {
        background: "#333",
      },
      "::-webkit-scrollbar-thumb": {
        background: "#555",
      },
    }),
    option: (base: any, state: { isFocused: any }) => ({
      ...base,
      backgroundColor: state.isFocused ? "#444" : "#222",
      color: "#fff",
      "&:active": {
        backgroundColor: "#555",
      },
    }),
    singleValue: (base: any) => ({
      ...base,
      color: "#fff",
    }),
    placeholder: (base: any) => ({
      ...base,
      color: "#aaa",
    }),
    input: (base: any) => ({
      ...base,
      color: "#fff",
    }),
    dropdownIndicator: (base: any) => ({
      ...base,
      color: "#aaa",
      "&:hover": {
        color: "#fff",
      },
    }),
    clearIndicator: (base: any) => ({
      ...base,
      color: "#aaa",
      "&:hover": {
        color: "#fff",
      },
    }),
  };

  return (
    <div className="select-cnt">
      <label htmlFor={"select" + uid}>
        {props.label}{" "}
        <span className="required-asterisk">{props.isRequired ? "*" : ""}</span>
      </label>
      <Select
        id={"select" + uid}
        className={!isValid || isNotEmpty ? "error-input" : ""}
        value={props.options.find((opt) => opt.value === props.value) || null}
        options={props.options || []}
        onChange={(selectedOption) => {
          const newValue = selectedOption ? selectedOption.value : "";
          setIsNotEmpty(Boolean(newValue));
          props.updateValue(newValue);
        }}
        placeholder={props.label}
        onBlur={() =>
          blurCheck(props.value, props, setIsValid, setIsNotEmpty, "text")
        }
        styles={darkThemeStyles}
        classNamePrefix="custom-select"
      />
      <ErroTextCnt
        isRequired={props.isRequired}
        isValid={!isValid}
        IsNotEmpty={isNotEmpty}
      />
    </div>
  );
}
