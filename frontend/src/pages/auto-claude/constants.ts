import React from 'react';
import {
  Play,
  Pause,
  Square,
  Clock,
  CheckCircle2,
  XCircle,
  Loader2,
} from 'lucide-react';

export const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-surface-100 text-surface-700',
  initializing: 'bg-primary-100 text-primary-700',
  running: 'bg-accent-100 text-accent-700',
  paused: 'bg-highlight-100 text-highlight-700',
  completed: 'bg-primary-100 text-primary-700',
  failed: 'bg-red-100 text-red-700',
  cancelled: 'bg-surface-100 text-surface-600',
};

export const STATUS_ICONS: Record<string, React.ReactNode> = {
  pending: React.createElement(Clock, { className: 'w-4 h-4' }),
  initializing: React.createElement(Loader2, { className: 'w-4 h-4 animate-spin' }),
  running: React.createElement(Play, { className: 'w-4 h-4' }),
  paused: React.createElement(Pause, { className: 'w-4 h-4' }),
  completed: React.createElement(CheckCircle2, { className: 'w-4 h-4' }),
  failed: React.createElement(XCircle, { className: 'w-4 h-4' }),
  cancelled: React.createElement(Square, { className: 'w-4 h-4' }),
};

export const LOG_TYPE_COLORS: Record<string, string> = {
  info: 'text-primary-400',
  warning: 'text-highlight-400',
  error: 'text-red-400',
  stdout: 'text-accent-400',
  stderr: 'text-red-300',
};

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${mins}m`;
}
