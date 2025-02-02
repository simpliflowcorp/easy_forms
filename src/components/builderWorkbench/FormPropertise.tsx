import * as React from "react";
import PrimaryActionButton from "../buttons/PrimaryActionButton";
import SecondaryActionButton from "../buttons/SecondaryActionButton";
import SecondaryButton from "../buttons/SecondaryButton";
import PrimaryButton from "../buttons/PrimaryButton";
import TextFieldInput from "../Inputs/TextFieldInput";
import { useLanguageStore } from "@/store/store";
import ToogleSwitch from "../buttons/ToogleSwitch";
import SortableOptionList from "../lists/SortableOptionList";
import TextAreaInput from "../Inputs/TextAreaInput";
import { set } from "mongoose";
import DateFieldInput from "../Inputs/DateFieldInput";

export interface IFormPropertiseProps {
  formPropertise: any;
  close: () => void;
  updateFormElement: (element: any) => void;
}

export default function FormPropertise(props: IFormPropertiseProps) {
  const lang = useLanguageStore((state) => state.language);
  const [data, setData] = React.useState(props.formPropertise);
  const [reset, setReset] = React.useState(0);
  const [isValid, setIsValid] = React.useState({
    name: true,
    expiry: true,
    description: true,
  });

  const updateElement = () => {
    // update element
    if (
      isValid.name &&
      isValid.expiry &&
      isValid.description &&
      data.name !== "" &&
      data.expiry !== ""
    ) {
      props.updateFormElement(data);
      props.close();
    } else {
      setIsValid((prev) => ({
        ...prev,
        name: data.name !== "",
        expiry: data.expiry !== "",
      }));
      setReset((prev) => prev + 1);
    }
  };

  const closeSec = () => {
    if (
      data.name !== "" &&
      data.expiry !== "" &&
      isValid.expiry &&
      isValid.description
    ) {
      props.close();
    }
  };
  console.log(isValid);

  return (
    <div
      onClick={() => {
        closeSec();
      }}
      className="window-overlay"
    >
      <div
        onClick={(e) => {
          e.stopPropagation();
        }}
        className="element-propertise-cnt"
      >
        <div className="element-propertise">
          <div className="element-propertise-header">
            <span className="element-propertise-header-title">
              {lang.form_propertise}
            </span>
            <div className="btn-cnt">
              <SecondaryButton
                label={"cancel"}
                action={() => {
                  props.close();
                }}
              />

              <PrimaryButton
                label={"save"}
                action={() => {
                  updateElement();
                }}
              />
            </div>
          </div>
          <div className="element-propertise-body">
            <div className="body-section-content">
              <TextFieldInput
                label="Name"
                updateValue={(e: string) => {
                  setData({ ...data, name: e });
                }}
                value={data.name}
                updateIsValid={(e) =>
                  setIsValid((prev) => ({ ...prev, name: e }))
                }
                isValid={isValid.name}
                isRequired={true}
                reset={reset}
              />

              <DateFieldInput
                label="Expiry Date"
                updateValue={(e: any) => {
                  let exp = new Date(e).valueOf() + 1000 * 60 * 60 * 24 - 1;
                  console.log(new Date(exp).toISOString());
                  setData({
                    ...data,
                    expiry: new Date(exp).toISOString(),
                  });
                }}
                value={data.expiry}
                updateIsValid={(e) =>
                  setIsValid((prev) => ({ ...prev, expiry: e }))
                }
                isValid={isValid.expiry}
                isRequired={true}
                isDisableOldDate={true}
                reset={reset}
              />

              <TextAreaInput
                label="Description"
                updateValue={(e: string) => {
                  setData({ ...data, description: e });
                }}
                value={data.description}
                updateIsValid={(e) =>
                  setIsValid((prev) => ({ ...prev, description: e }))
                }
                isValid={isValid.description}
                isRequired={false}
                reset={reset}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
