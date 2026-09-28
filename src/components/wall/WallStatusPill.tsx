interface WallStatusPillProps {
  label: string;
  /** 0..1; omitted for an indeterminate status. */
  progress?: number | undefined;
}

/** Small floating glass status (import / cloud metadata progress) at the top of the wall. */
export default function WallStatusPill({ label, progress }: WallStatusPillProps) {
  return (
    <div className="wall-float wall-status-pill" role="status">
      <span>{label}</span>
      {progress !== undefined && (
        <span className="wall-status-pill__track" aria-hidden="true">
          <span className="wall-status-pill__fill" style={{ width: `${Math.round(Math.min(1, Math.max(0, progress)) * 100)}%` }} />
        </span>
      )}
    </div>
  );
}
