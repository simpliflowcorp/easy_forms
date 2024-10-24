export const validationCheck = (
  value: string,
  required: boolean,
  type: string
): number => {
  if (required && value === "") return 2;

  switch (type) {
    case "email":
      const emailRegex =
        /^(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;
      return emailRegex.test(value.toLowerCase()) ? 1 : 3;
    case "password":
      const passwordRegex = /^.{8,}$/; // Minimum 8 characters
      return passwordRegex.test(value) ? 1 : 3;
    default:
      return 1;
  }
};
export const blurCheck = (
  value: string,
  props: any,
  setIsValid: any,
  setIsNotEmpty: any,
  type: string
) => {
  if (type !== "password") value = value.trim();
  let validationRes = validationCheck(value, props.isRequired, type);
  if (validationRes === 1) {
    props.updateIsValid(true);
    setIsNotEmpty(true);
    props.updateValue(value);
    setIsValid(true);
  } else if (validationRes === 2) {
    props.updateIsValid(false);
    setIsNotEmpty(false);
  } else if (validationRes === 3) {
    props.updateIsValid(false);
    setIsValid(false);
    setIsNotEmpty(true);
  }
};
