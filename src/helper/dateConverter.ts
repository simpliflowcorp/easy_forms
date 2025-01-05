export default function dateConverter(date: any) {
  return new Date(date * 1).toLocaleDateString("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
