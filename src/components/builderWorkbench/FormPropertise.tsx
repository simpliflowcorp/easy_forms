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
  const [isValid, setIsValid] = React.useState({
    name: true,
    expiry: true,
    description: true,
  });

  const updateElement = () => {
    // update element
    if (isValid) {
      props.updateFormElement(data);
      props.close();
    }
  };

  return (
    <div
      onClick={() => {
        props.close();
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
              {lang.element_propertise}
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
                updateIsValid={() =>
                  setIsValid((prev) => ({ ...prev, name: true }))
                }
                isValid={isValid.name}
                isRequired={true}
                reset={1}
              />

              <DateFieldInput
                label="Expiry Date"
                updateValue={(e: string) => {
                  setData({ ...data, expiry: e });
                }}
                value={data.expiry}
                updateIsValid={() =>
                  setIsValid((prev) => ({ ...prev, expiry: true }))
                }
                isValid={isValid.expiry}
                isRequired={true}
                reset={1}
              />

              <TextAreaInput
                label="Description"
                updateValue={(e: string) => {
                  setData({ ...data, description: e });
                }}
                value={data.description}
                updateIsValid={() =>
                  setIsValid((prev) => ({ ...prev, description: true }))
                }
                isValid={isValid.description}
                isRequired={false}
                reset={1}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
