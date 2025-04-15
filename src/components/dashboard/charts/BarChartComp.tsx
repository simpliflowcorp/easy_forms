import dateConverter from "@/helper/dateConverter";
import generateColorShades from "@/helper/generateColorShades";
import { useLanguageStore } from "@/store/store";
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
  index: string;
};
export default function BarChartComp(props: Props) {
  const [chartData, setChartData] = React.useState(props.data);
  const [chartKeys, setChartKeys] = React.useState([] as any);
  const [barColorArray, setBarColorArray] = React.useState([] as any);

  const [noData, setNoData] = React.useState(false);
  const lang = useLanguageStore((state) => state.language);

  React.useEffect(() => {
    if (props.data.length > 0) {
      let data = props.data.map((key: any) => {
        return { name: dateConverter(key[props.index]), ...key };
      });

      let keys = Object.keys(props.data[0]).filter(
        (key) => key !== props.index
      );

      setChartData(data);
      setChartKeys(keys);
      let colors = generateColorShades("#6439FF", "#7CF5FF", keys.length);
      setBarColorArray(colors);
    } else {
      setNoData(true);
    }
  }, [props.data]);

  if (noData) {
    return (
      <div className="no-data-cnt">
        <i className="ic-inbox"></i>
        <h3>{lang.no_data_found}</h3>
      </div>
    );
  } else
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
