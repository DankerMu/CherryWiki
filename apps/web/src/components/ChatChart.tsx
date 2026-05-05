import ReactECharts from 'echarts-for-react';

type ChatChartProps = {
  option: Record<string, unknown>;
  chartType: string | null;
};

export default function ChatChart({ option, chartType }: ChatChartProps) {
  return (
    <div className="chat-chart-panel" aria-label="Chart data">
      <div className="chat-chart-header">
        <strong>图表</strong>
        {chartType !== null ? <span className="status-badge status-info">{chartType}</span> : null}
      </div>
      <ReactECharts
        option={option}
        notMerge
        lazyUpdate
        style={{ width: '100%', height: '280px' }}
      />
    </div>
  );
}
