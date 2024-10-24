"use client";

import * as React from "react";
import { blurCheck, validationCheck } from "../../helper/validationCheck";
import { useLanguageStore } from "@/store/store";
import ErroTextCnt from "./components/ErrorTextCnt";

export interface IPasswordInputProps {
  label: string;
  value: string;
  updateValue: (value: string) => void;
  updateIsValid: (value: boolean) => void;
  isValid: boolean;
  isRequired: boolean;
  reset: number;
}

export default function PasswordInput(props: IPasswordInputProps) {
  const [isValid, setIsValid] = React.useState(true);
  const [IsNotEmpty, setIsNotEmpty] = React.useState(true);
  const [value, setValue] = React.useState(props.value as string);
  const lang = useLanguageStore((state) => state.language);
  const [showPassword, setShowPassword] = React.useState(false);

  React.useEffect(() => {
    if (props.reset) {
      if (props.value === "") {
        setIsNotEmpty(false);
      } else {
        setIsValid(props.isValid);
      }
    }
  }, [props.value, props.isValid, props.reset]);

  return (
    <>
      <div className="input-cnt">
        <label htmlFor="password">{props.label}</label>
        <div className="password-inp-cnt">
          <input
            type={showPassword ? "text" : "password"}
            id="password"
            className={!isValid || !IsNotEmpty ? "error-input" : ""}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onBlur={() => {
              blurCheck(value, props, setIsValid, setIsNotEmpty, "password");
            }}
          />
          {showPassword ? (
            <i
              onClick={() => {
                setShowPassword((p) => !p);
              }}
              className="ic-eye-slash inp-right-side-flot"
            ></i>
          ) : (
            <i
              onClick={() => {
                setShowPassword((p) => !p);
              }}
              className="ic-eye inp-right-side-flot"
            ></i>
          )}
        </div>
        <ErroTextCnt isValid={!isValid} IsNotEmpty={!IsNotEmpty} />
      </div>
    </>
  );
}
