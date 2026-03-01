import React, { useState, useEffect } from 'react';
import { i18n } from '../services/i18n';

interface ThemeViewProps {}

const ThemeView: React.FC<ThemeViewProps> = () => {
  // Force re-render when language changes
  const [, setLanguageVersion] = useState(0);

  useEffect(() => {
    const unsubscribe = i18n.subscribe(() => {
      setLanguageVersion(v => v + 1);
    });
    return unsubscribe;
  }, []);

  return (
    <div className="max-w-5xl mx-auto w-full flex flex-col h-full">
      {/* Header */}
      <div className="mb-4 flex-shrink-0 flex items-center justify-between">
        <div>
          <h1 className="text-4xl font-extrabold mb-2">{i18n.t('theme.title')}</h1>
          <p className="text-white/40">{i18n.t('theme.description')}</p>
        </div>
      </div>

      {/* Theme Content */}
      <div className="flex-1 overflow-hidden">
        <div className="h-full overflow-y-auto no-scrollbar flex items-center justify-center">
          <div className="text-center opacity-40">
            <span className="material-symbols-outlined text-6xl mb-4 block">checkroom</span>
            <p className="text-xl font-medium">{i18n.t('theme.comingSoon')}</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ThemeView;
