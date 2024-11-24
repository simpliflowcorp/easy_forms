import React from "react";
import TextFieldInput from "./TextFieldInput";
import NumberFieldInput from "./NumberFieldInput";
import DecimalNumberFieldInput from "./DecimalNumberFieldInput";
import Email from "next-auth/providers/email";
import EmailInput from "./EmailInput";
import PasswordInput from "./PasswordInput";

type Props = {
  type: number;
  label: string;
  value: string;
  updateValue: (value: string) => void;
  updateIsValid: (value: boolean) => void;
  isValid: boolean;
  reset: number;
  isRequired: boolean;
};

const DynamicFieldManger = (props: Props) => {
  const fieldManager = () => {
    switch (props.type) {
      case 1:
        return (
          <TextFieldInput
            label={props.label}
            value={props.value}
            updateValue={props.updateValue}
            updateIsValid={props.updateIsValid}
            isValid={props.isValid}
            isRequired={props.isRequired}
            reset={props.reset}
          />
        );
        break;
      case 2:
        return (
          <NumberFieldInput
            label={props.label}
            value={props.value}
            updateValue={props.updateValue}
            updateIsValid={props.updateIsValid}
            isValid={props.isValid}
            isRequired={props.isRequired}
            reset={props.reset}
          />
        );
        break;
      case 3:
        return (
          <DecimalNumberFieldInput
            label={props.label}
            value={props.value}
            updateValue={props.updateValue}
            updateIsValid={props.updateIsValid}
            isValid={props.isValid}
            isRequired={props.isRequired}
            reset={props.reset}
          />
        );
        break;
      case 4:
        return (
          <EmailInput
            label={props.label}
            value={props.value}
            updateValue={props.updateValue}
            updateIsValid={props.updateIsValid}
            isValid={props.isValid}
            isRequired={props.isRequired}
            reset={props.reset}
          />
        );
        break;
      case 101:
        return (
          <PasswordInput
            label={props.label}
            value={props.value}
            updateValue={props.updateValue}
            updateIsValid={props.updateIsValid}
            isValid={props.isValid}
            isRequired={props.isRequired}
            reset={props.reset}
          />
        );
      default:
        return <div></div>;
    }
  };
  return <div></div>;
};
