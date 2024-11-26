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
  const [isValid, setIsValid] = React.useState(props.isValid);
  const [isNotEmpty, setIsNotEmpty] = React.useState(Boolean(props.value));
  const lang = useLanguageStore((state) => state.language);

  React.useEffect(() => {
    if (props.reset) {
      setIsNotEmpty(Boolean(props.value));
      setIsValid(props.isValid);
    }
  }, [props.reset, props.value, props.isValid]);

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
    <div className="input-cnt">
      <label htmlFor="select">
        {props.label}{" "}
        <span className="required-asterisk">{props.isRequired ? "*" : ""}</span>
      </label>
      <Select
        id="select"
        className={!isValid || !isNotEmpty ? "error-input" : ""}
        value={props.options.find((opt) => opt.value === props.value) || null}
        options={props.options || []}
        onChange={(selectedOption) => {
          const newValue = selectedOption ? selectedOption.value : "";
          setIsNotEmpty(Boolean(newValue));
          props.updateValue(newValue);
        }}
        placeholder={props.label}
        onBlur={() =>
          blurCheck(props.value, props, setIsValid, setIsNotEmpty, "select")
        }
        styles={darkThemeStyles}
        classNamePrefix="custom-select"
      />
      <ErroTextCnt isValid={!isValid} IsNotEmpty={!isNotEmpty} />
    </div>
  );
}
