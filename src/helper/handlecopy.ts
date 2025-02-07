import { successHandler } from "./successHandler";

export const handleCopy = async (
  textToCopy: string,
  successText: string,
  errorText: string
) => {
  try {
    await navigator.clipboard.writeText(textToCopy);
    successHandler(successText);
  } catch (err) {
    console.error("Failed to copy:", err);
  }
};
