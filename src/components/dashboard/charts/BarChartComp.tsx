import dateConverter from "@/helper/dateConverter";
import generateColorShades from "@/helper/generateColorShades";
import React from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  Rectangle,
  ResponsiveContainer,
} from "recharts";
type Props = {
  data: any;
};
export default function BarChartComp(props: Props) {
  const datas = [
    {
      name: "Page A",
      uv: 4000,
      pv: 2400,
      amt: 2400,
    },

    {
      name: "Page B",
      uv: 3000,
      pv: 1398,
      amt: 2210,
    },
    {
      name: "Page C",
      uv: 2000,
      pv: 9800,
      amt: 2290,
    },
    {
      name: "Page D",
      uv: 2780,
      pv: 3908,
      amt: 2000,
    },
    {
      name: "Page E",
      uv: 1890,
      pv: 4800,
      amt: 2181,
    },
    {
      name: "Page F",
      uv: 2390,
      pv: 3800,
      amt: 2500,
    },
    {
      name: "Page G",
      uv: 3490,
      pv: 4300,
      amt: 2100,
    },
  ];

  const [chartData, setChartData] = React.useState(props.data);
  const [chartKeys, setChartKeys] = React.useState([] as any);
  const [barColorArray, setBarColorArray] = React.useState([] as any);

  React.useEffect(() => {
    let workingData = { banana: 0, apple: 0, orange: 0 };

    let data = Object.keys(props.data).map((key: any) => {
      return { name: dateConverter(key), ...props.data[key] };
    });

    let keys = Object.values(props.data).map((val: any) => {
      return Object.keys(val);
    });

    setChartData(data);
    setChartKeys(keys[0]);
    let colors = generateColorShades("#6439FF", "#7CF5FF", keys[0].length);
    setBarColorArray(colors);
  }, [props.data]);

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart
        width={1000}
        height={300}
        data={chartData}
        margin={{
          top: 5,
          right: 5,
          left: 5,
          bottom: 5,
        }}
      >
        <XAxis axisLine={false} tickLine={false} dataKey="name" />
        <YAxis axisLine={false} tickLine={false} />
        <Tooltip />
        {chartKeys.map((key: any, index: any) => {
          return <Bar key={key} dataKey={key} fill={barColorArray[index]} />;
        })}
      </BarChart>
    </ResponsiveContainer>
  );
}
