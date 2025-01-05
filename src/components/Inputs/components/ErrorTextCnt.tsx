import { useLanguageStore } from "@/store/store";
import * as React from "react";

export interface IErroTextCntProps {
  IsNotEmpty: boolean;
  isValid: boolean;
  isRequired: boolean;
}

export default function ErroTextCnt(props: IErroTextCntProps) {
  const lang = useLanguageStore((state) => state.language);

  return (
    <div className="input-err-cnt">
      {props.IsNotEmpty && <span className="err-text">{lang.required}</span>}
      {props.isRequired ? (
        props.isValid &&
        !props.IsNotEmpty && (
          <span className="err-text">{lang.invalid_format}</span>
        )
      ) : props.isValid ? (
        <span className="err-text">{lang.invalid_format}</span>
      ) : (
        ""
      )}
    </div>
  );
}
