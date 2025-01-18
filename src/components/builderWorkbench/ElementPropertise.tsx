import * as React from "react";
import PrimaryActionButton from "../buttons/PrimaryActionButton";
import SecondaryActionButton from "../buttons/SecondaryActionButton";
import SecondaryButton from "../buttons/SecondaryButton";
import PrimaryButton from "../buttons/PrimaryButton";
import TextFieldInput from "../Inputs/TextFieldInput";
import { useLanguageStore } from "@/store/store";
import ToogleSwitch from "../buttons/ToogleSwitch";
import SortableOptionList from "../lists/SortableOptionList";

export interface IElementPropertiseProps {
  elementPropertise: any;
  close: () => void;
  updateFormElement: (element: any) => void;
}

export default function ElementPropertise(props: IElementPropertiseProps) {
  const lang = useLanguageStore((state) => state.language);
  const [data, setData] = React.useState(props.elementPropertise);
  const [isValid, setIsValid] = React.useState(true);

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
            <div className="element-propertise-body-section">
              <div className="body-section-content">
                <TextFieldInput
                  label="Name"
                  updateValue={(e: string) => {
                    setData({ ...data, label: e });
                  }}
                  value={data.label}
                  updateIsValid={setIsValid}
                  isValid={isValid}
                  isRequired={true}
                  reset={1}
                />

                <ToogleSwitch
                  value={data.required}
                  label="is_required"
                  action={() => {
                    setData({ ...data, required: !data.required ? 1 : 0 });
                  }}
                />
                <ToogleSwitch
                  value={data.unique}
                  label="is_unique"
                  action={() => {
                    setData({ ...data, unique: !data.unique ? 1 : 0 });
                  }}
                />
              </div>
              <div className="option-section-content">
                {data.options?.length > 0 ? (
                  <SortableOptionList
                    options={data.options}
                    updateOptions={(options: any[]) => {
                      setData({ ...data, options });
                    }}
                  />
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
