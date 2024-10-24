import toast from "react-hot-toast";

export const successHandler = (response: any, lang: any) => {
  toast.success(
    lang[response.data.message]
      ? lang[response.data.message]
      : response.data.message
  );
};
