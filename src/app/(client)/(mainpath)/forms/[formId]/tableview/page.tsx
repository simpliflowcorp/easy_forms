"use client";
import IconButton from "@/components/buttons/IconButton";
import PrimaryActionButton from "@/components/buttons/PrimaryActionButton";
import PrimaryButton from "@/components/buttons/PrimaryButton";
import Icon from "@/components/icons/Icon";
import { useLanguageStore } from "@/store/store";
import axios from "axios";
import exp from "constants";
import { useRouter } from "next/navigation";
import * as React from "react";
import Select from "react-select";

export interface IformsProps {}

export default function forms(props: IformsProps) {
  const lang = useLanguageStore((state) => state.language);
  const router = useRouter();

  // const testModel = async () => {
  //   let res = await axios.post("/api/testDb", { test: "T1" });

  // };
  // React.useEffect(() => {
  //   testModel();
  // });

  const barChartData = {};

  const [isActive, setIsActive] = React.useState("all" as string);

  const [gotData, setGotData] = React.useState(false);

  const [data, setData] = React.useState({} as any);

  const [forms, setForms] = React.useState([
    {
      id: 1,
      name: "SIGN UP FORM",
      status: 1,
      expiry: new Date().valueOf() + 24 * 60 * 60 * 1000,
      total_responses: 1,
      today_responses: 10,
    },
  ] as any);

  const [pinnedCol, setPinnedCol] = React.useState({
    "1": true,
    "2": false,
    "3": false,
    "4": false,
    "5": false,
    "6": false,
    "7": false,
    "8": false,
    "9": false,
  });

  function countDown(expiringDate: number) {
    const now = Date.now();
    const timeRemaining = expiringDate - now;
    const totalHours = Math.floor(timeRemaining / (1000 * 60 * 60));
    const minutes = Math.floor(
      (timeRemaining % (1000 * 60 * 60)) / (1000 * 60)
    );
    const seconds = Math.floor((timeRemaining % (1000 * 60)) / 1000);

    return `${totalHours}h ${minutes}m ${seconds}s`;
  }

  const metaData = {
    name: "SIGN UP FORM",
    description:
      "This is a sign up form. Used to collect user data for the upcoming event. The form includes fields for first name, last name, email, phone, and address. Each field is required to ensure we gather all necessary information from the users. The form is divided into two columns for better organization and readability. The form will expire in two days from now, and its current status is active. Users can fill out the form to register for the event, and the collected data will be used for event planning and communication purposes.",
    expriy: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
    status: 1,
    elements: [
      {
        id: 1,
        label: "First Name",
        type: 1,
        required: 1,
        unique: 0,
        column: 1,
        position: 1,
      },
      {
        id: 2,
        label: "Last Name",
        type: 1,
        required: 1,
        unique: 0,
        column: 2,
        position: 1,
      },
      {
        id: 3,
        label: "Email",
        type: 1,
        required: 1,
        unique: 0,
        column: 1,
        position: 2,
      },
      {
        id: 4,
        label: "Phone",
        type: 1,
        required: 1,
        unique: 0,
        column: 2,
        position: 2,
      },
      {
        id: 5,
        label: "Address",
        type: 1,
        required: 1,
        unique: 0,
        column: 1,
        position: 3,
      },
      {
        id: 6,
        label: "Select Option",
        type: 11,
        required: 1,
        unique: 0,
        column: 2,
        position: 3,
        option: [
          { id: 1, label: "Option 1" },
          { id: 2, label: "Option 2" },
          { id: 3, label: "Option 3" },
          { id: 4, label: "Option 4" },
          { id: 5, label: "Option 5" },
        ],
      },
      {
        id: 7,
        label: "Country",
        type: 1,
        required: 1,
        unique: 0,
        column: 1,
        position: 3,
      },
      {
        id: 8,
        label: "state",
        type: 1,
        required: 1,
        unique: 0,
        column: 1,
        position: 3,
      },
      {
        id: 9,
        label: "city",
        type: 1,
        required: 1,
        unique: 0,
        column: 1,
        position: 3,
      },
      {
        id: 10,
        label: "street",
        type: 1,
        required: 1,
        unique: 0,
        column: 1,
        position: 3,
      },
      {
        id: 11,
        label: "road",
        type: 1,
        required: 1,
        unique: 0,
        column: 1,
        position: 3,
      },
      {
        id: 12,
        label: "juuj",
        type: 1,
        required: 1,
        unique: 0,
        column: 1,
        position: 3,
      },
    ],
  };

  const formsData = [
    {
      id: 1,
      created_time: new Date().valueOf(),
      "1": "test",
      "2": "2",
      "3": "test@lll.com",
      "4": "1331651651",
      "5": "1123/5 adsccdscadsc ascadsc ascssac asc ascascas sca wdcdsc dscds sdc sdcds vds vdsvb dsv dssc asc ascas cas casc assc",
      "6": "2",
      "7": "1331651651",
      "8": "1123/5 adsccdscadsc ascadsc ascssac asc ascascas sca wdcdsc dscds sdc sdcds vds vdsvb dsv dssc asc ascas cas casc assc",
      "9": "2",
      "10": "1331651651",
      "11": "1123/5 adsccdscadsc ascadsc ascssac asc ascascas sca wdcdsc dscds sdc sdcds vds vdsvb dsv dssc asc ascas cas casc assc",
      "12": "2",
    },
    {
      id: 2,
      created_time: new Date().valueOf(),
      "1": "test",
      "2": "2",
      "3": "csascas@casc.csa",
      "4": "123123123",
      "5": "123/123 asdascascasc",
      "6": "1",
      "7": "1331651651",
      "8": "1123/5 adsccdscadsc ascadsc ascssac asc ascascas sca wdcdsc dscds sdc sdcds vds vdsvb dsv dssc asc ascas cas casc assc",
      "9": "2",
      "10": "1331651651",
      "11": "1123/5 adsccdscadsc ascadsc ascssac asc ascascas sca wdcdsc dscds sdc sdcds vds vdsvb dsv dssc asc ascas cas casc assc",
      "12": "2",
    },
    {
      id: 3,
      created_time: new Date().valueOf(),
      "1": "test",
      "2": "2",
      "3": "csascas@casc.csa",
      "4": "123123123",
      "5": "123/123 asdascascasc asdascasc",
      "6": "1",
      "7": "1331651651",
      "8": "1123/5 adsccdscadsc ascadsc ascssac asc ascascas sca wdcdsc dscds sdc sdcds vds vdsvb dsv dssc asc ascas cas casc assc",
      "9": "2",
      "10": "1331651651",
      "11": "1123/5 adsccdscadsc ascadsc ascssac asc ascascas sca wdcdsc dscds sdc sdcds vds vdsvb dsv dssc asc ascas cas casc assc",
      "12": "2",
    },
    {
      id: 4,
      created_time: new Date().valueOf(),
      "1": "test",
      "2": "2",
      "3": "test@lll.com",
      "4": "1331651651",
      "5": "1123/5 adsccdscadsc ascadsc ascssac asc ascascas sca wdcdsc dscds sdc sdcds vds vdsvb dsv dssc asc ascas cas casc assc",
      "6": "2",
      "7": "1331651651",
      "8": "1123/5 adsccdscadsc ascadsc ascssac asc ascascas sca wdcdsc dscds sdc sdcds vds vdsvb dsv dssc asc ascas cas casc assc",
      "9": "2",
      "10": "1331651651",
      "11": "1123/5 adsccdscadsc ascadsc ascssac asc ascascas sca wdcdsc dscds sdc sdcds vds vdsvb dsv dssc asc ascas cas casc assc",
      "12": "2",
    },
    {
      id: 5,
      created_time: new Date().valueOf(),
      "1": "test",
      "2": "2",
      "3": "csascas@casc.csa",
      "4": "123123123",
      "5": "123/123 asdascascasc",
      "6": "1",
      "7": "1331651651",
      "8": "1123/5 adsccdscadsc ascadsc ascssac asc ascascas sca wdcdsc dscds sdc sdcds vds vdsvb dsv dssc asc ascas cas casc assc",
      "9": "2",
      "10": "1331651651",
      "11": "1123/5 adsccdscadsc ascadsc ascssac asc ascascas sca wdcdsc dscds sdc sdcds vds vdsvb dsv dssc asc ascas cas casc assc",
      "12": "2",
    },
    {
      id: 6,
      created_time: new Date().valueOf(),
      "1": "test",
      "2": "2",
      "3": "csascas@casc.csa",
      "4": "123123123",
      "5": "123/123 asdascascasc asdascasc",
      "6": "1",
      "7": "1331651651",
      "8": "1123/5 adsccdscadsc ascadsc ascssac asc ascascas sca wdcdsc dscds sdc sdcds vds vdsvb dsv dssc asc ascas cas casc assc",
      "9": "2",
      "10": "1331651651",
      "11": "1123/5 adsccdscadsc ascadsc ascssac asc ascascas sca wdcdsc dscds sdc sdcds vds vdsvb dsv dssc asc ascas cas casc assc",
      "12": "2",
    },
    {
      id: 7,
      created_time: new Date().valueOf(),
      "1": "test",
      "2": "2",
      "3": "test@lll.com",
      "4": "1331651651",
      "5": "1123/5 adsccdscadsc ascadsc ascssac asc ascascas sca wdcdsc dscds sdc sdcds vds vdsvb dsv dssc asc ascas cas casc assc",
      "6": "2",
      "7": "1331651651",
      "8": "1123/5 adsccdscadsc ascadsc ascssac asc ascascas sca wdcdsc dscds sdc sdcds vds vdsvb dsv dssc asc ascas cas casc assc",
      "9": "2",
      "10": "1331651651",
      "11": "1123/5 adsccdscadsc ascadsc ascssac asc ascascas sca wdcdsc dscds sdc sdcds vds vdsvb dsv dssc asc ascas cas casc assc",
      "12": "2",
    },
    {
      id: 8,
      created_time: new Date().valueOf(),
      "1": "test",
      "2": "2",
      "3": "csascas@casc.csa",
      "4": "123123123",
      "5": "123/123 asdascascasc",
      "6": "1",
      "7": "1331651651",
      "8": "1123/5 adsccdscadsc ascadsc ascssac asc ascascas sca wdcdsc dscds sdc sdcds vds vdsvb dsv dssc asc ascas cas casc assc",
      "9": "2",
      "10": "1331651651",
      "11": "1123/5 adsccdscadsc ascadsc ascssac asc ascascas sca wdcdsc dscds sdc sdcds vds vdsvb dsv dssc asc ascas cas casc assc",
      "12": "2",
    },
    {
      id: 9,
      created_time: new Date().valueOf(),
      "1": "test",
      "2": "2",
      "3": "csascas@casc.csa",
      "4": "123123123",
      "5": "123/123 asdascascasc asdascasc",
      "6": "1",
      "7": "1331651651",
      "8": "1123/5 adsccdscadsc ascadsc ascssac asc ascascas sca wdcdsc dscds sdc sdcds vds vdsvb dsv dssc asc ascas cas casc assc",
      "9": "2",
      "10": "1331651651",
      "11": "1123/5 adsccdscadsc ascadsc ascssac asc ascascas sca wdcdsc dscds sdc sdcds vds vdsvb dsv dssc asc ascas cas casc assc",
      "12": "2",
    },
    {
      id: 10,
      created_time: new Date().valueOf(),
      "1": "test",
      "2": "2",
      "3": "test@lll.com",
      "4": "1331651651",
      "5": "1123/5 adsccdscadsc ascadsc ascssac asc ascascas sca wdcdsc dscds sdc sdcds vds vdsvb dsv dssc asc ascas cas casc assc",
      "6": "2",
      "7": "1331651651",
      "8": "1123/5 adsccdscadsc ascadsc ascssac asc ascascas sca wdcdsc dscds sdc sdcds vds vdsvb dsv dssc asc ascas cas casc assc",
      "9": "2",
      "10": "1331651651",
      "11": "1123/5 adsccdscadsc ascadsc ascssac asc ascascas sca wdcdsc dscds sdc sdcds vds vdsvb dsv dssc asc ascas cas casc assc",
      "12": "2",
    },
    {
      id: 11,
      created_time: new Date().valueOf(),
      "1": "test",
      "2": "2",
      "3": "csascas@casc.csa",
      "4": "123123123",
      "5": "123/123 asdascascasc",
      "6": "1",
      "7": "1331651651",
      "8": "1123/5 adsccdscadsc ascadsc ascssac asc ascascas sca wdcdsc dscds sdc sdcds vds vdsvb dsv dssc asc ascas cas casc assc",
      "9": "2",
      "10": "1331651651",
      "11": "1123/5 adsccdscadsc ascadsc ascssac asc ascascas sca wdcdsc dscds sdc sdcds vds vdsvb dsv dssc asc ascas cas casc assc",
      "12": "2",
    },
    {
      id: 12,
      created_time: new Date().valueOf(),
      "1": "test",
      "2": "2",
      "3": "csascas@casc.csa",
      "4": "123123123",
      "5": "123/123 asdascascasc asdascasc",
      "6": "1",
      "7": "1331651651",
      "8": "1123/5 adsccdscadsc ascadsc ascssac asc ascascas sca wdcdsc dscds sdc sdcds vds vdsvb dsv dssc asc ascas cas casc assc",
      "9": "2",
      "10": "1331651651",
      "11": "1123/5 adsccdscadsc ascadsc ascssac asc ascascas sca wdcdsc dscds sdc sdcds vds vdsvb dsv dssc asc ascas cas casc assc",
      "12": "2",
    },
    {
      id: 13,
      created_time: new Date().valueOf(),
      "1": "test",
      "2": "2",
      "3": "test@lll.com",
      "4": "1331651651",
      "5": "1123/5 adsccdscadsc ascadsc ascssac asc ascascas sca wdcdsc dscds sdc sdcds vds vdsvb dsv dssc asc ascas cas casc assc",
      "6": "2",
      "7": "1331651651",
      "8": "1123/5 adsccdscadsc ascadsc ascssac asc ascascas sca wdcdsc dscds sdc sdcds vds vdsvb dsv dssc asc ascas cas casc assc",
      "9": "2",
      "10": "1331651651",
      "11": "1123/5 adsccdscadsc ascadsc ascssac asc ascascas sca wdcdsc dscds sdc sdcds vds vdsvb dsv dssc asc ascas cas casc assc",
      "12": "2",
    },
    {
      id: 14,
      created_time: new Date().valueOf(),
      "1": "test",
      "2": "2",
      "3": "csascas@casc.csa",
      "4": "123123123",
      "5": "123/123 asdascascasc",
      "6": "1",
      "7": "1331651651",
      "8": "1123/5 adsccdscadsc ascadsc ascssac asc ascascas sca wdcdsc dscds sdc sdcds vds vdsvb dsv dssc asc ascas cas casc assc",
      "9": "2",
      "10": "1331651651",
      "11": "1123/5 adsccdscadsc ascadsc ascssac asc ascascas sca wdcdsc dscds sdc sdcds vds vdsvb dsv dssc asc ascas cas casc assc",
      "12": "2",
    },
    {
      id: 15,
      created_time: new Date().valueOf(),
      "1": "test",
      "2": "2",
      "3": "csascas@casc.csa",
      "4": "123123123",
      "5": "123/123 asdascascasc asdascasc",
      "6": "1",
      "7": "1331651651",
      "8": "1123/5 adsccdscadsc ascadsc ascssac asc ascascas sca wdcdsc dscds sdc sdcds vds vdsvb dsv dssc asc ascas cas casc assc",
      "9": "2",
      "10": "1331651651",
      "11": "1123/5 adsccdscadsc ascadsc ascssac asc ascascas sca wdcdsc dscds sdc sdcds vds vdsvb dsv dssc asc ascas cas casc assc",
      "12": "2",
    },
  ];

  const rowCountOptions = [
    { value: "10", label: "10" },
    { value: "20", label: "20" },
    { value: "30", label: "30" },
    { value: "40", label: "40" },
    { value: "50", label: "50" },
  ];

  const [rowCount, setRowCount] = React.useState("10");

  const darkThemeStyles = {
    control: (base: any, state: { isFocused: any }) => ({
      ...base,
      backgroundColor: "#333",
      color: "#fff",
      border: state.isFocused ? "1px solid #555" : "1px solid #444",
      boxShadow: state.isFocused ? "0 0 0 1px #555" : "none",
      "&:hover": {
        border: "1px solid #555",
      },
    }),

    menu: (base: any) => ({
      ...base,
      backgroundColor: "#222",
      color: "#fff",
    }),

    menuList: (base: any) => ({
      ...base,
      backgroundColor: "#222",
      color: "#fff",
      "::-webkit-scrollbar": {
        width: "8px",
      },
      "::-webkit-scrollbar-track": {
        background: "#333",
      },
      "::-webkit-scrollbar-thumb": {
        background: "#555",
      },
    }),

    option: (base: any, state: { isFocused: any }) => ({
      ...base,
      backgroundColor: state.isFocused ? "#444" : "#222",
      color: "#fff",
      "&:active": {
        backgroundColor: "#555",
      },
    }),

    singleValue: (base: any) => ({
      ...base,
      color: "#fff",
    }),

    placeholder: (base: any) => ({
      ...base,
      color: "#aaa",
    }),

    input: (base: any) => ({
      ...base,
      color: "#fff",
    }),

    dropdownIndicator: (base: any) => ({
      ...base,
      color: "#aaa",
      "&:hover": {
        color: "#fff",
      },
    }),

    clearIndicator: (base: any) => ({
      ...base,
      color: "#aaa",
      "&:hover": {
        color: "#fff",
      },
    }),
  };

  return (
    <div className="form-cnt">
      <div className="form-header">
        <div className="left">
          <div className="form-sec-header-left">
            <div className="header-indicator">/</div>
            <div className="header-text">{metaData.name}</div>
          </div>
          <div className="form-sec-header-right">
            <div
              className={
                metaData.status === 1
                  ? "forms-sec-item-status active"
                  : "forms-sec-item-status expired"
              }
            >
              {metaData.status === 1 ? lang.active : lang.expired}
            </div>
          </div>
        </div>

        <div className="right">
          <PrimaryButton
            label={"export"}
            action={() => router.push("/forms/create")}
          />
        </div>
      </div>

      <div className="table-sec-cnt">
        <div className="table-sec">
          <div className="table-sec-header">
            <div className="table-sec-header-left">
              <Select
                id={"select" + "page"}
                value={
                  rowCountOptions.find((opt: any) => opt.value === rowCount) ||
                  null
                }
                options={rowCountOptions}
                onChange={(e: any) => {
                  setRowCount(e.value);
                }}
                onBlur={() => {}}
                styles={darkThemeStyles}
              />
            </div>
            <div className="table-sec-header-right">
              <div className="manage-col">
                <IconButton action={() => {}} icon="table" />
              </div>
              <div className="pagination">
                <IconButton action={() => {}} icon="chevron-left" />
                <IconButton action={() => {}} icon="chevron-right" />
              </div>
            </div>
          </div>
          <div className="table-sec-body">
            <div className="table-header">
              <div className="t-row">
                <div className="sticky-row">
                  {metaData.elements
                    .filter((e: any) => {
                      return pinnedCol[e.id];
                    })
                    .map((element: any) => (
                      <div
                        className={pinnedCol[element.id] ? "t-cell " : "t-cell"}
                      >
                        <span className="cell-left">{element.label}</span>
                        <span className="cell-right">
                          {!pinnedCol[element.id] ? (
                            <Icon
                              action={() => {
                                setPinnedCol({
                                  ...pinnedCol,
                                  [element.id]: !pinnedCol[element.id],
                                });
                              }}
                              icon="pin-angle"
                            />
                          ) : (
                            <Icon
                              action={() => {
                                setPinnedCol({
                                  ...pinnedCol,
                                  [element.id]: !pinnedCol[element.id],
                                });
                              }}
                              icon="pin"
                            />
                          )}
                          <div className="sort-sec">
                            <Icon action={() => {}} icon="caret-up" />
                            <Icon action={() => {}} icon="caret-down" />
                          </div>
                        </span>
                      </div>
                    ))}
                </div>
                {metaData.elements
                  .filter((e: any) => {
                    return !pinnedCol[e.id];
                  })
                  .map((element: any) => (
                    <div
                      className={pinnedCol[element.id] ? "t-cell " : "t-cell"}
                    >
                      <span className="cell-left">{element.label}</span>
                      <span className="cell-right">
                        {!pinnedCol[element.id] ? (
                          <Icon
                            action={() => {
                              setPinnedCol({
                                ...pinnedCol,
                                [element.id]: !pinnedCol[element.id],
                              });
                            }}
                            icon="pin-angle"
                          />
                        ) : (
                          <Icon
                            action={() => {
                              setPinnedCol({
                                ...pinnedCol,
                                [element.id]: !pinnedCol[element.id],
                              });
                            }}
                            icon="pin"
                          />
                        )}
                        <div className="sort-sec">
                          <Icon action={() => {}} icon="caret-up" />
                          <Icon action={() => {}} icon="caret-down" />
                        </div>
                      </span>
                    </div>
                  ))}
              </div>
            </div>
            <div className="table-body">
              {formsData.map((form: any) => (
                <div className="t-row">
                  <div className="sticky-row">
                    {metaData.elements
                      .filter((e: any) => {
                        return pinnedCol[e.id];
                      })
                      .map((element: any, index: any) => (
                        <div
                          key={index + "o" + element.id}
                          className={
                            pinnedCol[element.id] ? "t-cell" : "t-cell"
                          }
                        >
                          <span className="cell-left"> {form[element.id]}</span>
                        </div>
                      ))}
                  </div>
                  <div className="unsticky-row">
                    {metaData.elements
                      .filter((e: any) => {
                        return !pinnedCol[e.id];
                      })
                      .map((element: any, index: any) => (
                        <div
                          key={index + "o" + element.id}
                          className={
                            pinnedCol[element.id] ? "t-cell" : "t-cell"
                          }
                        >
                          <span className="cell-left"> {form[element.id]}</span>
                        </div>
                      ))}
                  </div>
                </div>
              ))}
              {/* {formsData.map((form: any) => (
                <div className="t-row">
                  <div className="unsticky-row">
                    {metaData.elements
                      .filter((e: any) => {
                        return !pinnedCol[e.id];
                      })
                      .map((element: any, index: any) => (
                        <div
                          key={index + "o" + element.id}
                          className={
                            pinnedCol[element.id] ? "t-cell sticky" : "t-cell"
                          }
                        >
                          <span className="cell-left"> {form[element.id]}</span>
                        </div>
                      ))}
                  </div>
                </div>
              ))} */}
            </div>
          </div>

          <div className="table-sec-footer">
            <span>page 1 of 1</span>
            <span>
              {formsData.length +
                " " +
                lang.of +
                " " +
                formsData.length +
                " " +
                lang.responses}
            </span>
            {/* <span>
              Responses {formsData.length} of {formsData.length}
            </span> */}
          </div>
        </div>
      </div>
    </div>
  );
}
