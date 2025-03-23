"use client";

import FullPageLoader from "@/components/Loaders/FullPageLoader";
import { useLanguageStore } from "@/store/store";
import React, { useEffect, useState } from "react";

const LanguageWrapper = ({ children }: { children: React.ReactNode }) => {
  const setLanguage = useLanguageStore((state) => state.setLanguage);
  const [gotData, setGotData] = useState(false);

  const loadLanguage = async (lang: string) => {
    try {
      const json = await import(`../language/${lang}.json`);
      setLanguage(json.default, lang);
      localStorage.setItem("lang", lang); // Ensure persistence
      setGotData(true);
    } catch (error) {
      console.error("Error loading language:", error);
      if (lang !== "en") loadLanguage("en"); // Fallback to English
    }
  };

  useEffect(() => {
    const lang = localStorage.getItem("lang") || "en";
    loadLanguage(lang);

    // Listen for language changes across tabs
    const handleStorageChange = (event: StorageEvent) => {
      if (event.key === "lang" && event.newValue) {
        loadLanguage(event.newValue);
      }
    };
    window.addEventListener("storage", handleStorageChange);

    return () => window.removeEventListener("storage", handleStorageChange);
  }, [setLanguage]);

  if (!gotData)
    return (
      <body>
        <FullPageLoader />
      </body>
    );

  return <>{children}</>;
};

export default LanguageWrapper;
