import React from 'react';

export type IconButtonVariant = 'ghost' | 'active';
export type IconButtonSize = 'sm' | 'md' | 'lg';

interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Material Symbols glyph name. */
  icon: string;
  /** Accessible name — required, since the button has no text label. */
  label: string;
  variant?: IconButtonVariant;
  size?: IconButtonSize;
  /** Circular instead of the theme's default button radius. */
  round?: boolean;
  /** Render the glyph in its filled variant. */
  filled?: boolean;
  /** Extra classes for the glyph itself (e.g. custom font-size overrides). */
  glyphClassName?: string;
}

/**
 * Icon-only control. Enforces an accessible `label` (mapped to aria-label)
 * because there is no visible text. Hover/active/focus styling lives in
 * styles/ui.css.
 */
const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  {
    icon,
    label,
    variant = 'ghost',
    size = 'md',
    round,
    filled,
    glyphClassName,
    className,
    type,
    ...rest
  },
  ref,
) {
  const classes = [
    'ui-icon-btn',
    `ui-icon-btn--${variant}`,
    `ui-icon-btn--${size}`,
    round ? 'ui-icon-btn--round' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  const glyphClasses = [
    'material-symbols-outlined',
    'ui-icon-btn__glyph',
    filled ? 'fill-1' : '',
    glyphClassName ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button
      ref={ref}
      type={type ?? 'button'}
      className={classes}
      aria-label={label}
      title={label}
      {...rest}
    >
      <span className={glyphClasses}>{icon}</span>
    </button>
  );
});

export default IconButton;
