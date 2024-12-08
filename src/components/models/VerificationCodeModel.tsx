import React, { useState } from "react";
import CloseButton from "../buttons/CloseButton";
import { useLanguageStore } from "@/store/store";
import TextFieldInput from "../Inputs/TextFieldInput";
import PrimaryActionButton from "../buttons/PrimaryActionButton";

type Props = {
  action: () => void;
  closeAction: () => void;
  label: string;
  value: string;
  updateValue: (value: string) => void;
  updateIsValid: (value: boolean) => void;
  isValid: boolean;
  isRequired: boolean;
  reset: number;
};

const VerificationCodeModel = (props: Props) => {
  const lang = useLanguageStore((state) => state.language);
  const [resetBtn, setResetBtn] = useState(props.reset);

  React.useEffect(() => {
    setResetBtn(props.reset);
  }, [props.reset]);

  return (
    <div className="verification-code-model">
      <div className="model-cnt">
        <span className="model-header">Verification</span>
        <CloseButton close={props.closeAction} />
        <div className="model-body">
          <span className="body-text">
            Please enter the verification code sent to your current email
            address
          </span>
          <div className="input-cnt">
            <TextFieldInput
              label="Verification Code"
              value={props.value}
              updateValue={(e) => {
                props.updateValue(e);
              }}
              updateIsValid={(e) => {
                props.updateIsValid(e);
              }}
              isValid={props.isValid}
              isRequired={true}
              reset={resetBtn}
            />
          </div>
          <div className="btn-cnt">
            <PrimaryActionButton
              resetBtn={resetBtn}
              label={"verify"}
              action={() => {
                props.action();
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default VerificationCodeModel;
