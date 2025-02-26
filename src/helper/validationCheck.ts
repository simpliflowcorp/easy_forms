export const validationCheck = (
  value: any,
  required: boolean,
  type: string
): number => {
  if (required && value === "") return 2;

  switch (type) {
    case "array":
      if (Array.isArray(value)) {
        return value.length > 0 ? 1 : 2; // Valid if array has elements
      }
      return 3;
    case "email":
      const emailRegex =
        /^(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;
      return emailRegex.test(value.toLowerCase()) ? 1 : 3;
    case "password":
      const passwordRegex = /^.{8,}$/; // Minimum 8 characters
      return passwordRegex.test(value) ? 1 : 3;

    case "text":
      return 1;
    case "number":
      const numberRegex = /^(?:[0-9]+)?$/gm;
      return numberRegex.test(value) ? 1 : 3;
    case "decimal":
      const decimalNumberRegex = /^[0-9]+(\.[0-9]+)?$/gm;
      return decimalNumberRegex.test(value) ? 1 : 3;
    default:
      return 1;
  }
};

export const blurCheck = (
  value: any,
  props: any,
  setIsValid: any,
  setIsNotEmpty: any,
  type: string
) => {
  if (type !== "password" && type !== "array") value = value.trim();
  let validationRes = validationCheck(value, props.isRequired, type);
  console.log(validationRes);

  if (validationRes === 1) {
    props.updateIsValid(true);
    props.updateValue(value);
    setIsNotEmpty(false);
    setIsValid(true);
  } else if (validationRes === 2) {
    props.updateIsValid(false);
    setIsNotEmpty(true);
  } else if (validationRes === 3) {
    props.updateIsValid(false);
    setIsValid(false);
    setIsNotEmpty(true);
  }
};
