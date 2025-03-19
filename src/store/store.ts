import { create } from "zustand";

type Language = {
  [key: string]: string;
};

interface LanguageStore {
  language: Language;
  languageKey: string;
  setLanguage: (lang: Language, languageKey: string) => void;
}

export const useLanguageStore = create<LanguageStore>((set) => ({
  language: {},
  languageKey: "en",
  setLanguage: (lang, languageKey) => set({ language: lang, languageKey }),
}));
