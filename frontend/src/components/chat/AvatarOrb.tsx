import { X } from 'lucide-react';
import clsx from 'clsx';
import { BotIcon, BotIconType } from '../BotIcon';
import type { OrbState } from '../../hooks/useVoiceMode';

interface AvatarOrbProps {
  state: OrbState;
  onDismiss: () => void;
  botIcon: BotIconType;
  modelName: string;
}

function ringClass(state: OrbState, ringIndex: number): string {
  const delay = ringIndex === 1 ? 'orb-delay-1' : ringIndex === 2 ? 'orb-delay-2' : '';
  switch (state) {
    case 'idle':
      return `border-violet-500/20 orb-breathe ${delay}`;
    case 'thinking':
      return `border-amber-500/30 orb-think ${delay}`;
    case 'speaking':
      return `border-violet-400/40 orb-speak ${delay}`;
    case 'done':
      return 'border-violet-500/10 orb-fade-out';
    default:
      return '';
  }
}

function coreClass(state: OrbState): string {
  switch (state) {
    case 'idle': return 'orb-core-breathe';
    case 'thinking': return 'orb-core-think';
    case 'speaking': return 'orb-core-speak';
    case 'done': return 'orb-fade-out';
    default: return '';
  }
}

function stateLabel(state: OrbState): string {
  switch (state) {
    case 'idle': return 'In ascolto...';
    case 'thinking': return 'Sto pensando...';
    case 'speaking': return 'Sto parlando...';
    case 'done': return '';
    default: return '';
  }
}

export default function AvatarOrb({ state, onDismiss, botIcon, modelName }: AvatarOrbProps) {
  if (state === 'hidden') return null;

  const label = stateLabel(state);

  return (
    <div
      className="fixed inset-0 z-50 bg-surface-950/95 flex flex-col items-center justify-center orb-overlay-enter cursor-pointer"
      onClick={onDismiss}
      role="dialog"
      aria-label="Avatar AI"
    >
      {/* Close button */}
      <button
        onClick={onDismiss}
        aria-label="Chiudi avatar"
        className="absolute top-6 right-6 p-2 rounded-full text-surface-400 hover:text-white hover:bg-surface-800 transition-colors"
        style={{ paddingTop: 'calc(0.5rem + var(--safe-area-inset-top))' }}
      >
        <X className="w-6 h-6" />
      </button>

      {/* Model name */}
      <p
        className="absolute top-6 left-1/2 -translate-x-1/2 text-surface-400 text-sm font-medium"
        style={{ paddingTop: 'var(--safe-area-inset-top)' }}
      >
        {modelName}
      </p>

      {/* Orb */}
      <div className="relative w-64 h-64 flex items-center justify-center" onClick={(e) => e.stopPropagation()}>
        {/* Outer ring */}
        <div className={clsx('absolute rounded-full w-64 h-64 border-2 transition-all duration-500', ringClass(state, 0))} />
        {/* Middle ring */}
        <div className={clsx('absolute rounded-full w-48 h-48 border-2 transition-all duration-500', ringClass(state, 1))} />
        {/* Inner ring */}
        <div className={clsx('absolute rounded-full w-32 h-32 border-2 transition-all duration-500', ringClass(state, 2))} />
        {/* Core */}
        <div className={clsx(
          'relative z-10 w-20 h-20 rounded-full',
          'bg-gradient-to-br from-violet-500 to-purple-600',
          'flex items-center justify-center',
          coreClass(state),
        )}>
          <BotIcon type={botIcon} size={40} className="text-white" />
        </div>
      </div>

      {/* State label */}
      {label && (
        <p className="mt-8 text-surface-300 text-sm font-medium" aria-live="polite" aria-atomic="true">
          {label}
        </p>
      )}

      {/* Dismiss hint */}
      <p className="absolute bottom-8 text-surface-500 text-xs" style={{ paddingBottom: 'var(--safe-area-inset-bottom)' }}>
        Tocca per chiudere
      </p>
    </div>
  );
}
