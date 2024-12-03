import React, { useState } from "react";
import CloseButton from "../buttons/CloseButton";
import { useLanguageStore } from "@/store/store";
import TextFieldInput from "../Inputs/TextFieldInput";

type Props = {
  action: () => void;
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
  const [verifyCode, setVerifyCode] = useState("");
  const [verifyCodeValid, setVerifyCodeValid] = useState(false);
  const [resetBtn, setResetBtn] = useState(0);

  return (
    <div className="verification-code-model">
      <div className="model-cnt">
        <span className="model-header">Verification Code</span>
        <CloseButton />
        <div className="model-body">
          <span className="body-text">
            Please enter the verification code sent to your email address
          </span>
          <div className="input-cnt">
            <TextFieldInput
              label="Verification Code"
              value={verifyCode}
              updateValue={(e) => {
                setVerifyCode(e);
              }}
              updateIsValid={(e) => {
                setVerifyCodeValid(e);
              }}
              isValid={verifyCodeValid}
              isRequired={true}
              reset={resetBtn}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default VerificationCodeModel;
