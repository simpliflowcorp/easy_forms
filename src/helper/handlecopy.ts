import toast from "react-hot-toast";

export const handleCopy = async (
  textToCopy: string,
  successText: string,
  errorText: string
) => {
  try {
    await navigator.clipboard.writeText(textToCopy);
    toast.success(successText);
  } catch (err) {
    console.error("Failed to copy:", err);
  }
};
