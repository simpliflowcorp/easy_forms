import React from "react";
import LineChartComp from "./LineChartComp";
import BarChartComp from "./BarChartComp";
import RadarChartComp from "./RadarChartComp";
import PieChartComp from "./PieChartComp";

type Props = {
  label: string;
  type: string;
  data: any;
};

export const ChartComponetManger = (props: Props) => {
  const chartManager = () => {
    switch (props.type) {
      case "line":
        return <LineChartComp data={props.data} />;
        break;

      case "bar":
        return <BarChartComp data={props.data} />;
        break;

      case "radar":
        return <RadarChartComp data={props.data} />;
        break;

      case "pie":
        return <PieChartComp data={props.data} />;
        break;

      default:
        return <div></div>;
    }
  };
  return (
    <div className="chart-wrapper">
      <div className="chart-cnt">
        <div className="chart-header">
          <span className="header-text">{props.label}</span>
        </div>
        <div className="chart-data">{chartManager()}</div>
      </div>
    </div>
  );
};
