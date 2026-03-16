import React from 'react';
import { createRoot } from 'react-dom/client';
import { AgentsApp } from './AgentsApp';

const root = createRoot(document.getElementById('root')!);
root.render(<AgentsApp />);
