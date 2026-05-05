import { lazy, Suspense } from 'react';

const ReactECharts = lazy(() => import('echarts-for-react'));

type ChatChartProps = {
  option: Record<string, unknown>;
  chartType: string | null;
};

const ALLOWED_SERIES_TYPES = new Set(['bar', 'line', 'pie']);

function sanitizeOption(raw: Record<string, unknown>): Record<string, unknown> {
  const safe: Record<string, unknown> = {};
  const allowedKeys = new Set(['xAxis', 'yAxis', 'series', 'legend', 'grid', 'dataset']);
  for (const key of Object.keys(raw)) {
    if (allowedKeys.has(key)) {
      safe[key] = raw[key];
    }
  }
  if (Array.isArray(safe.series)) {
    safe.series = (safe.series as Array<Record<string, unknown>>).map((s) => {
      const { tooltip: _t, label: _l, formatter: _f, rich: _r, ...rest } = s;
      if (typeof rest.type === 'string' && !ALLOWED_SERIES_TYPES.has(rest.type)) {
        rest.type = 'bar';
      }
      return rest;
    });
  }
  safe.tooltip = { show: true, confine: true };
  safe.animation = false;
  return safe;
}

export default function ChatChart({ option, chartType }: ChatChartProps) {
  const sanitized = sanitizeOption(option);
  return (
    <div className="chat-chart-panel" aria-label="Chart data">
      <div className="chat-chart-header">
        <strong>图表</strong>
        {chartType !== null ? <span className="status-badge status-info">{chartType}</span> : null}
      </div>
      <Suspense fallback={<div style={{ height: '280px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>加载图表...</div>}>
        <ReactECharts
          option={sanitized}
          notMerge
          lazyUpdate
          style={{ width: '100%', height: '280px' }}
        />
      </Suspense>
    </div>
  );
}
