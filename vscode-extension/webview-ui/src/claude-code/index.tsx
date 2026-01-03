import React from 'react';
import { createRoot } from 'react-dom/client';
import MainLayout from './MainLayout';
import './claudeCode.css';

// Get the root element
const rootElement = document.getElementById('root');

if (rootElement) {
  const root = createRoot(rootElement);
  root.render(
    <React.StrictMode>
      <MainLayout />
    </React.StrictMode>
  );
} else {
  console.error('Root element not found');
}
