"use client";
import React, { useEffect } from "react";
import { useLanguageStore } from "@/store/store";

type Props = {};

const Publish = (props: Props) => {
  const lang = useLanguageStore((state) => state.language);

  const getFormData = async () => {
    let formId = window.location.pathname.split("/")[2];

    console.log(formId);
  };

  useEffect(() => {
    getFormData();
  }, []);

  return <div>Publish</div>;
};
export default Publish;
