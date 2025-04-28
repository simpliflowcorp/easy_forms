"use client";

import FullPageLoader from "@/components/Loaders/FullPageLoader";
import { useLanguageStore } from "@/store/store";
import React, { useEffect, useState } from "react";

const LanguageWrapper = ({ children }: { children: React.ReactNode }) => {
  const setLanguage = useLanguageStore((state) => state.setLanguage);
  const langKey = useLanguageStore((state) => state.languageKey);
  const [gotData, setGotData] = useState(false);

  const loadLanguage = async (lang: string) => {
    try {
      const json = await import(`../language/${lang}.json`);
      setLanguage(json.default, lang);
      localStorage.setItem("lang", lang);
      setGotData(true);
    } catch (error) {
      console.error("Error loading language:", error);
      if (lang !== "en") loadLanguage("en");
    }
  };

  useEffect(() => {
    const lang = localStorage.getItem("lang") || "en";
    loadLanguage(lang);

    const handleStorageChange = (event: StorageEvent) => {
      if (event.key === "lang" && event.newValue) {
        loadLanguage(event.newValue);
      }
    };

    window.addEventListener("storage", handleStorageChange);

    return () => {
      window.removeEventListener("storage", handleStorageChange);
    };
  }, []); // <-- Empty dependency array to run only once

  // Optional: If you want to **detect** when `languageKey` changes separately:
  useEffect(() => {
    console.log("Language changed to:", langKey);
    // you can do something here if needed
  }, [langKey]);

  if (!gotData)
    return (
      <body>
        <FullPageLoader />
      </body>
    );

  return <>{children}</>;
};

export default LanguageWrapper;
