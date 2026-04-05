import React, { Component, ErrorInfo, ReactNode } from 'react';
import { i18n } from '../services/i18n';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ErrorBoundary caught an error:', error);
    console.error('Error info:', errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex items-center justify-center h-screen bg-background">
          <div className="text-center p-8">
            <span className="material-symbols-outlined text-6xl text-red-400 mb-4">error</span>
            <h1 className="text-2xl font-bold mb-2" style={{ color: 'var(--theme-text-primary, #fff)' }}>{i18n.t('errorBoundary.title')}</h1>
            <p className="mb-4" style={{ color: 'var(--theme-text-secondary, rgba(255,255,255,0.6))' }}>{i18n.t('errorBoundary.description')}</p>
            <p className="text-sm mb-4" style={{ color: 'var(--theme-text-muted, rgba(255,255,255,0.4))' }}>{i18n.t('errorBoundary.errorLabel')}: {this.state.error?.message}</p>
            <button
              onClick={() => window.location.reload()}
              className="px-4 py-2 rounded-lg transition-all"
              style={{ backgroundColor: 'var(--theme-primary, #3b82f6)', color: 'var(--theme-text-primary, #fff)' }}
            >
              {i18n.t('errorBoundary.reload')}
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
