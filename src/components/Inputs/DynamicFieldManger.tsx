import React from "react";
import TextFieldInput from "./TextFieldInput";

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
        return <EmailInput />;
        break;
      case 3:
        return <PasswordInput />;
        break;
      default:
        return <div></div>;
    }
  };
  return <div></div>;
};
