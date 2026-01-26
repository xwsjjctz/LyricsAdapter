import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';

const rootElement = document.getElementById('root');

if (!rootElement) {
  console.error("Could not find root element");
} else {
  try {
    const root = createRoot(rootElement);
    root.render(<App />);
  } catch (err) {
    console.error("Failed to render React app:", err);
    rootElement.innerHTML = `
      <div style="padding: 20px; color: white; background: #800; border-radius: 8px; margin: 20px;">
        <h2>Startup Error</h2>
        <p>${err instanceof Error ? err.message : String(err)}</p>
        <p>Please check the browser console for details.</p>
      </div>
    `;
  }
}