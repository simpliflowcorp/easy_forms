"use client";

import FullPageLoader from "@/components/Loaders/FullPageLoader";
import { useLanguageStore } from "@/store/store";
import React, { useEffect } from "react";

const LanguageWrapper = ({ children }: { children: React.ReactNode }) => {
  const setLanguage = useLanguageStore((state) => state.setLanguage);
  const [gotData, setGotData] = React.useState(false);

  useEffect(() => {
    let lang = localStorage.getItem("lang") || "en";
    import(`../language/${lang}.json`)
      .then((json) => {
        setLanguage(json.default);
        setGotData(true);
      })
      .catch((error) => {
        // Handle any errors
        console.error("Error importing module:", error);
      });
  }, [setLanguage]);

  if (!gotData)
    return (
      <body>
        <FullPageLoader />{" "}
      </body>
    );
  else return <>{children}</>;
};

export default LanguageWrapper;
