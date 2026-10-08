import React from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Material Symbols glyph name rendered before the label. */
  icon?: string;
  /** Stretch to the full width of the parent. */
  block?: boolean;
}

/**
 * Labelled action button. All visual states (hover/active/disabled/
 * focus-visible) live in styles/ui.css and read the `--theme-*` custom
 * properties, so callers never wire inline hover handlers or read colors
 * from themeManager.
 */
const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', icon, block, className, children, type, ...rest },
  ref,
) {
  const classes = [
    'ui-btn',
    `ui-btn--${variant}`,
    `ui-btn--${size}`,
    block ? 'ui-btn--block' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button ref={ref} type={type ?? 'button'} className={classes} {...rest}>
      {icon && <span className="material-symbols-rounded ui-btn__icon">{icon}</span>}
      {children}
    </button>
  );
});

export default Button;
