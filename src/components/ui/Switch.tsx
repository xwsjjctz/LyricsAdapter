import { THEME_IDS } from '../../types/theme';
import RetroSwitch from '../RetroSwitch';
import { useCurrentTheme } from '../settings/shared';

interface SwitchProps {
  checked: boolean;
  /** Accessible name; the switch has no visible label of its own. */
  label: string;
  describedBy?: string | undefined;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}

/** On/off control. The brutalist theme keeps its retro switch; others share .ui-switch. */
export default function Switch({ checked, label, describedBy, disabled = false, onChange }: SwitchProps) {
  const theme = useCurrentTheme();
  if (theme.id === THEME_IDS.BRUTALIST) {
    return <RetroSwitch checked={checked} ariaLabel={label} disabled={disabled} {...(describedBy ? { ariaDescribedBy: describedBy } : {})} onChange={onChange} />;
  }
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      aria-describedby={describedBy}
      disabled={disabled}
      className={`ui-switch${checked ? ' ui-switch--checked' : ''}`}
      onClick={() => onChange(!checked)}
    >
      <span className="ui-switch__thumb" />
    </button>
  );
}
