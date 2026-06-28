import React from 'react';
import AppWorkspace from './AppWorkspace';
import ErrorBoundary from './components/ErrorBoundary';

const App: React.FC = () => (
  <ErrorBoundary>
    <AppWorkspace />
  </ErrorBoundary>
);

export default App;
