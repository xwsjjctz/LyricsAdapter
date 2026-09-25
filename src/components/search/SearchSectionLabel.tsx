import type { ThemeColors } from '../../types/theme';

interface SearchSectionLabelProps {
  icon: string;
  label: string;
  count?: number | undefined;
  isLoading?: boolean | undefined;
  colors: ThemeColors;
}

export function SearchSectionLabel({ icon, label, count, isLoading, colors }: SearchSectionLabelProps) {
  return (
    <div className="search-result-section__label" style={{ color: colors.textMuted }}>
      <span className="material-symbols-outlined" aria-hidden="true">{icon}</span>
      <span>{label}</span>
      {typeof count === 'number' && <span className="search-result-section__count">({count})</span>}
      {isLoading && <span className="search-result-section__spinner" aria-hidden="true" />}
    </div>
  );
}
