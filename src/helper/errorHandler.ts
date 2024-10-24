import toast from "react-hot-toast";

export const errorHandler = (error: any, lang: any) => {
  toast.error(
    lang[error.response.data.message]
      ? lang[error.response.data.message]
      : error.response.data.message
  );
};
