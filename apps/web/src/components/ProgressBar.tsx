type ProgressBarProps = {
  percent: number;
  stage: string;
  size?: 'sm' | 'md';
};

export default function ProgressBar({ percent, stage, size = 'md' }: ProgressBarProps) {
  const clampedPercent = clampPercent(percent);

  return (
    <div className="progress-bar" data-size={size}>
      <div className="progress-bar-header">
        <span className="progress-bar-stage">{stage}</span>
        <span className="progress-bar-percent">{clampedPercent}%</span>
      </div>
      <div
        className="progress-bar-track"
        role="progressbar"
        aria-label={stage.length > 0 ? `${stage} progress` : 'Progress'}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={clampedPercent}
      >
        <div className="progress-bar-fill" style={{ width: `${clampedPercent}%` }} />
      </div>
    </div>
  );
}

function clampPercent(percent: number): number {
  if (!Number.isFinite(percent)) {
    return 0;
  }

  return Math.max(0, Math.min(100, Math.round(percent)));
}
