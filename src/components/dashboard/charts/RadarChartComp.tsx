import React from "react";
import {
  Radar,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  ResponsiveContainer,
} from "recharts";
type Props = {
  data: any;
  index: string;
};
export default function RadarChartComp(props: Props) {
  const [data, setData] = React.useState([{}]);

  React.useEffect(() => {
    setData(
      props.data.map((item: any) => ({
        name: item[props.index],
        value: item.value,
      }))
    );
  }, []);

  return (
    <ResponsiveContainer width="100%" height="100%">
      <RadarChart outerRadius={150} width={500} height={500} data={data}>
        <PolarGrid />
        <PolarAngleAxis dataKey="name" />
        <PolarRadiusAxis />
        <Radar
          name="Mike"
          dataKey="value"
          stroke="#6439FF"
          fill="#6439FF"
          fillOpacity={0.6}
        />
      </RadarChart>
    </ResponsiveContainer>
  );
}
