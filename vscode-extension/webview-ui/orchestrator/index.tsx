import React from 'react';
import { createRoot } from 'react-dom/client';
import { OrchestratorApp } from './OrchestratorApp';

const root = createRoot(document.getElementById('root')!);
root.render(<OrchestratorApp />);
