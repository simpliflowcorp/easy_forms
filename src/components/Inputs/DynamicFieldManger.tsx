import React from "react";
import TextFieldInput from "./TextFieldInput";
import NumberFieldInput from "./NumberFieldInput";
import DecimalNumberFieldInput from "./DecimalNumberFieldInput";
import Email from "next-auth/providers/email";
import EmailInput from "./EmailInput";
import PasswordInput from "./PasswordInput";
import SelectFieldInput from "./SelectFieldInput";
import CheckboxInput from "./CheckboxInput";
import RadioInput from "./RadioInput";
import ColorInput from "./ColorInput";
import RangeFieldInput from "./RangeFieldInput";
import DateFieldInput from "./DateFieldInput";
import DateTimeInputFieldInput from "./DateTimeFieldInput";
import TimeInputFieldInput from "./TimeFieldInput";
import TextAreaInput from "./TextAreaInput";

type Props = {
  type: number;
  label: string;
  value: any;
  updateValue: (value: string) => void;
  updateIsValid: (value: boolean) => void;
  isValid: boolean;
  reset: number;
  isRequired: boolean;
  options: { label: string; value: string }[];
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
      case 11:
        return (
          <SelectFieldInput
            options={props.options}
            label={props.label}
            value={props.value}
            updateValue={props.updateValue}
            updateIsValid={props.updateIsValid}
            isValid={props.isValid}
            isRequired={props.isRequired}
            reset={props.reset}
            isMulti={false}
          />
        );
      case 12:
        return (
          <SelectFieldInput
            options={props.options}
            label={props.label}
            value={props.value}
            updateValue={props.updateValue}
            updateIsValid={props.updateIsValid}
            isValid={props.isValid}
            isRequired={props.isRequired}
            reset={props.reset}
            isMulti={true}
          />
        );
      case 13:
        return (
          <CheckboxInput
            options={props.options}
            label={props.label}
            value={props.value}
            updateValue={props.updateValue}
            updateIsValid={props.updateIsValid}
            isValid={props.isValid}
            isRequired={props.isRequired}
            reset={props.reset}
          />
        );
      case 14:
        return (
          <RadioInput
            options={props.options}
            label={props.label}
            value={props.value}
            updateValue={props.updateValue}
            updateIsValid={props.updateIsValid}
            isValid={props.isValid}
            isRequired={props.isRequired}
            reset={props.reset}
          />
        );
      case 15:
        return (
          <ColorInput
            label={props.label}
            value={props.value}
            updateValue={props.updateValue}
            updateIsValid={props.updateIsValid}
            isValid={props.isValid}
            isRequired={props.isRequired}
            reset={props.reset}
          />
        );
      case 16:
        return (
          <RangeFieldInput
            label={props.label}
            value={props.value}
            updateValue={props.updateValue}
            updateIsValid={props.updateIsValid}
            isValid={props.isValid}
            isRequired={props.isRequired}
            reset={props.reset}
          />
        );

      case 21:
        return (
          <DateFieldInput
            label={props.label}
            value={props.value}
            updateValue={props.updateValue}
            updateIsValid={props.updateIsValid}
            isValid={props.isValid}
            isRequired={props.isRequired}
            reset={props.reset}
          />
        );

      case 22:
        return (
          <DateTimeInputFieldInput
            label={props.label}
            value={props.value}
            updateValue={props.updateValue}
            updateIsValid={props.updateIsValid}
            isValid={props.isValid}
            isRequired={props.isRequired}
            reset={props.reset}
          />
        );
      case 23:
        return (
          <TimeInputFieldInput
            label={props.label}
            value={props.value}
            updateValue={props.updateValue}
            updateIsValid={props.updateIsValid}
            isValid={props.isValid}
            isRequired={props.isRequired}
            reset={props.reset}
          />
        );

      case 41:
        return (
          <TextAreaInput
            label={props.label}
            value={props.value}
            updateValue={props.updateValue}
            updateIsValid={props.updateIsValid}
            isValid={props.isValid}
            isRequired={props.isRequired}
            reset={props.reset}
          />
        );

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
  return <div>{fieldManager()}</div>;
};

export default DynamicFieldManger;
