export default function dateConverter(date: any) {
  console.log(date);

  return new Date(date * 1).toLocaleDateString("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
