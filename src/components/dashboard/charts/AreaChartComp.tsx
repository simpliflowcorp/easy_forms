import generateColorShades from "@/helper/generateColorShades";
import { set } from "mongoose";
import React, { use } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  ResponsiveContainer,
  Tooltip,
  Legend,
} from "recharts";

type Props = {
  data: any;
  index: string;
};
export default function AreaChartComp(Props: Props) {
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
      <AreaChart
        width={500}
        height={400}
        data={data}
        margin={{
          top: 10,
          right: 30,
          left: 0,
          bottom: 0,
        }}
      >
        <defs>
          {barColorArray.map((color: any, index: any) => {
            return (
              <linearGradient id={color} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={"#" + color} stopOpacity={1} />
                <stop offset="95%" stopColor={"#" + color} stopOpacity={0} />
              </linearGradient>
            );
          })}
        </defs>

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
            <Area
              type="monotone"
              fillOpacity={1}
              fill={"url(#" + barColorArray[index] + ")"}
              key={key}
              dataKey={key}
              stroke={"#" + barColorArray[index]}
            />
          );
        })}

        {/* <Area
          type="monotone"
          dataKey="uv"
          stroke="#8884d8"
          fillOpacity={1}
          fill="url(#colorUv)"
        />

        <Area
          type="monotone"
          dataKey="pv"
          stroke="#82ca9d"
          fillOpacity={1}
          fill="url(#colorPv)"
        /> */}
      </AreaChart>
    </ResponsiveContainer>
  );
}
