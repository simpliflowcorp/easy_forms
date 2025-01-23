import generateColorShades from "@/helper/generateColorShades";
import React from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  Legend,
} from "recharts";
type Props = {
  data: any;
  index: string;
};
export default function LineChartComp(Props: Props) {
  const [data, setData] = React.useState<any>([]);
  const [varables, setVarables] = React.useState<any>([]);

  const [barColorArray, setBarColorArray] = React.useState<any>([]);

  React.useEffect(() => {
    let keys = Object.keys(Props.data[0]).filter((key) => key !== Props.index);
    setVarables(keys);

    let data = Props.data.map((item: any) => {
      let date = new Date(item[Props.index] * 1).toLocaleDateString();
      let obj: { [key: string]: any } = { name: date };
      keys.forEach((key: any) => {
        obj[key] = item[key];
      });
      return obj;
    });
    setData(data);
    let colors = generateColorShades("#6439FF", "#7CF5FF", keys.length);
    setBarColorArray(colors.map((color: any) => color.slice(1)));
  }, []);

  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart width={500} height={300} data={data}>
        <XAxis
          dataKey="name"
          padding={{ left: 15, right: 15 }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis axisLine={false} tickLine={false} />
        <Tooltip />
        <Legend />

        {varables.map((key: any, index: any) => {
          return (
            <Line
              type="monotone"
              key={key}
              dataKey={key}
              stroke={"#" + barColorArray[index]}
              activeDot={{ r: 6 }}
            />
          );
        })}
      </LineChart>
    </ResponsiveContainer>
  );
}
