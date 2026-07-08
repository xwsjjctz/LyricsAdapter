import React from 'react';

interface RetroSwitchProps {
  checked: boolean;
  ariaLabel: string;
  onChange: (checked: boolean) => void;
  className?: string;
}

const RetroSwitch: React.FC<RetroSwitchProps> = ({ checked, ariaLabel, onChange, className = '' }) => {
  return (
    <button
      type="button"
      className={`retro-switch ${checked ? 'retro-switch--checked' : ''} ${className}`.trim()}
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      onClick={() => onChange(!checked)}
    >
      <span className="retro-switch__thumb" />
    </button>
  );
};

export default RetroSwitch;
