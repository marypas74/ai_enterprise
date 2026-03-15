import React from 'react';
import { createRoot } from 'react-dom/client';
import { ChatApp } from './ChatApp';

const root = createRoot(document.getElementById('root')!);
root.render(<ChatApp />);
