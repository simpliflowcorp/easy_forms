"use client";
import IconButton from "@/components/buttons/IconButton";
import PrimaryActionButton from "@/components/buttons/PrimaryActionButton";
import PrimaryButton from "@/components/buttons/PrimaryButton";
import Icon from "@/components/icons/Icon";
import blobDownloader from "@/helper/blobDownloader";
import { errorHandler } from "@/helper/errorHandler";
import { useLanguageStore } from "@/store/store";
import axios from "axios";
import exp from "constants";
import { useRouter } from "next/navigation";
import * as React from "react";
import Select from "react-select";

export interface IformsProps {}
// Define the type for an element
interface Element {
  id: string;
}
export default function forms(props: IformsProps) {
  const lang = useLanguageStore((state) => state.language);
  const router = useRouter();

  const [gotData, setGotData] = React.useState(false);
  const [formData, setFormData] = React.useState({} as any);
  const [responseData, setResponseData] = React.useState([] as any);
  const [totalResponses, setTotalResponses] = React.useState(0 as number);

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

  const [pageParams, setPageParams] = React.useState({
    sortBy: "",
    sortOrder: "asc",
    pageNum: 1,
    rowCount: 10,
  });

  const [pinnedCol, setPinnedCol] = React.useState<{ [key: string]: boolean }>({
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

  const formsData = [{}];

  const rowCountOptions = [
    { value: 10, label: "10" },
    { value: 20, label: "20" },
    { value: 30, label: "30" },
    { value: 40, label: "40" },
    { value: 50, label: "50" },
  ];

  const [rowCount, setRowCount] = React.useState("10");

  const darkThemeStyles = {
    menuPortal: (base: any) => ({
      ...base,
      zIndex: 9999, // Ensures the menu is always on top
    }),

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

  const getResponseData = async () => {
    try {
      let res = await axios.post("/api/form/tableView", pageParams);
      setResponseData(res.data.data.responses);
      setTotalResponses(res.data.data.totalResponses);
    } catch (error) {
      errorHandler(error, lang);
    }
  };

  const getFormData = async () => {
    try {
      let res = await axios.get("/api/form/read");
      setFormData(res.data.data);
      console.log(res);
      let pins = res.data.data.elements.reduce((els: any, el: any) => {
        els[el.label] = false;
        return els;
      }, {});
      setPinnedCol(pins);
      setGotData(true);
    } catch (error) {
      errorHandler(error, lang);
    }
  };

  React.useEffect(() => {
    getResponseData();
    getFormData();
  }, []);

  React.useEffect(() => {
    if (gotData) getResponseData();
  }, [pageParams]);

  const exportData = async (data: string, filename?: string, type?: string) => {
    try {
      let res = await axios.get("/api/export/" + data, {
        responseType: "blob",
      });
      if (data === "pdf" || data === "pdftest") {
        // ✅ Read response as a Blob
        const blob = res.data;

        // ✅ Create a download link
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "test.pdf";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } else blobDownloader(res.data, filename || "default_filename", type);
    } catch (error) {
      console.log(error);
      errorHandler(error, lang);
    }
  };

  console.log(responseData);
  console.log(formData);

  if (!gotData) {
    return <div className="accent-line-loader"></div>;
  } else {
    return (
      <div className="form-cnt">
        <div className="form-header">
          <div className="left">
            <div className="form-sec-header-left">
              <div className="header-indicator">/</div>
              <div className="header-text">{formData.name}</div>
            </div>
            <div className="form-sec-header-right">
              <div
                className={
                  formData.status === 1
                    ? "forms-sec-item-status active"
                    : "forms-sec-item-status expired"
                }
              >
                {formData.status === 1 ? lang.active : lang.expired}
              </div>
            </div>
          </div>

          <div className="right">
            <PrimaryButton
              label={"export"}
              action={() => exportData("csv", "form.csv", "text/csv")}
            />
            <PrimaryButton
              label={"export_pdf"}
              action={() => exportData("pdf", "form.pdf", "application/pdf")}
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
                    rowCountOptions.find(
                      (opt: any) => opt.value === pageParams.rowCount
                    ) || null
                  }
                  options={rowCountOptions}
                  onChange={(e: any) => {
                    setPageParams((prev) => ({
                      ...prev,
                      rowCount: e.value,
                    }));
                  }}
                  onBlur={() => {}}
                  styles={darkThemeStyles}
                  menuPortalTarget={document.getElementById(
                    "select-popup-target"
                  )}
                />
              </div>
              <div className="table-sec-header-right">
                {/* <div className="manage-col">
                  <IconButton action={() => {}} icon="table" />
                </div> */}
                <div className="pagination">
                  <IconButton
                    isDisabled={
                      pageParams.pageNum === 1 || totalResponses === 0
                    }
                    action={() => {
                      setPageParams((prev) => ({
                        ...prev,
                        pageNum: prev.pageNum - 1,
                      }));
                    }}
                    icon="chevron-left"
                  />
                  <IconButton
                    isDisabled={
                      totalResponses === 0 ||
                      totalResponses <= pageParams.rowCount * pageParams.pageNum
                    }
                    action={() => {
                      setPageParams((prev) => ({
                        ...prev,
                        pageNum: prev.pageNum + 1,
                      }));
                    }}
                    icon="chevron-right"
                  />
                </div>
              </div>
            </div>
            <div className="table-sec-body">
              <div className="table-header">
                <div className="t-row">
                  <div className="sticky-row">
                    {formData.elements
                      .filter((e: any) => {
                        return pinnedCol[e.label];
                      })
                      .map((element: any) => (
                        <div
                          className={
                            pinnedCol[element.label] ? "t-cell " : "t-cell"
                          }
                        >
                          <span className="cell-left">{element.label}</span>
                          <span className="cell-right">
                            {!pinnedCol[element.label] ? (
                              <Icon
                                action={() => {
                                  setPinnedCol({
                                    ...pinnedCol,
                                    [element.label]: !pinnedCol[element.label],
                                  });
                                }}
                                icon="pin-angle"
                              />
                            ) : (
                              <Icon
                                action={() => {
                                  setPinnedCol({
                                    ...pinnedCol,
                                    [element.label]: !pinnedCol[element.label],
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
                  {formData.elements
                    .filter((e: any) => {
                      return !pinnedCol[e.label.toString()];
                    })
                    .map((element: any) => (
                      <div
                        className={
                          pinnedCol[element.label] ? "t-cell " : "t-cell"
                        }
                      >
                        <span className="cell-left">{element.label}</span>
                        <span className="cell-right">
                          {!pinnedCol[element.label] ? (
                            <Icon
                              action={() => {
                                setPinnedCol({
                                  ...pinnedCol,
                                  [element.label]: !pinnedCol[element.label],
                                });
                              }}
                              icon="pin-angle"
                            />
                          ) : (
                            <Icon
                              action={() => {
                                setPinnedCol({
                                  ...pinnedCol,
                                  [element.label]: !pinnedCol[element.label],
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
                {responseData.map((form: any) => (
                  <div className="t-row">
                    <div className="sticky-row">
                      {formData.elements
                        .filter((e: any) => {
                          return pinnedCol[e.label];
                        })
                        .map((element: any, index: any) => (
                          <div
                            key={index + "o" + element.label}
                            className={
                              pinnedCol[element.label] ? "t-cell" : "t-cell"
                            }
                          >
                            <span className="cell-left">
                              {Array.isArray(form.data[element.label])
                                ? form.data[element.label].join(", ")
                                : form.data[element.label]}
                            </span>
                          </div>
                        ))}
                    </div>
                    <div className="unsticky-row">
                      {formData.elements
                        .filter((e: any) => {
                          return !pinnedCol[e.label];
                        })
                        .map((element: any, index: any) => (
                          <div
                            key={index + "o" + element.label}
                            className={
                              pinnedCol[element.label] ? "t-cell" : "t-cell"
                            }
                          >
                            <span className="cell-left">
                              {Array.isArray(form.data[element.label])
                                ? form.data[element.label].join(", ")
                                : form.data[element.label]}
                            </span>
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
              <span>
                {lang.page +
                  " " +
                  pageParams.pageNum +
                  " " +
                  lang.of +
                  " " +
                  Math.ceil(totalResponses / pageParams.rowCount)}
              </span>
              <span>
                {responseData.length +
                  " " +
                  lang.of +
                  " " +
                  totalResponses +
                  " " +
                  lang.responses}
              </span>
            </div>
          </div>
        </div>
      </div>
    );
  }
}
