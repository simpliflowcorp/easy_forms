import { create } from "zustand";

type Language = {
  [key: string]: string;
};

interface LanguageStore {
  language: Language;
  setLanguage: (lang: Language) => void;
}

export const useLanguageStore = create<LanguageStore>((set) => ({
  language: {},
  setLanguage: (lang) => set({ language: lang }),
}));
