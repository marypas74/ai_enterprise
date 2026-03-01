import clsx from 'clsx';

interface TerminalSlotCardProps {
  slotNumber: number;
  status: 'available' | 'occupied' | 'reserved';
  sessionName?: string | null;
  onClick?: () => void;
}

const statusColors = {
  available: 'bg-surface-100 border-surface-200',
  occupied: 'bg-accent-50 border-accent-200',
  reserved: 'bg-highlight-50 border-highlight-200',
};

const dotColors = {
  available: 'bg-surface-400',
  occupied: 'bg-accent-500 animate-pulse',
  reserved: 'bg-highlight-500',
};

export default function TerminalSlotCard({ slotNumber, status, sessionName, onClick }: TerminalSlotCardProps) {
  const isClickable = status === 'occupied' && onClick;

  return (
    <div
      onClick={isClickable ? onClick : undefined}
      className={clsx(
        'rounded-lg border p-3 transition-colors',
        statusColors[status],
        isClickable && 'cursor-pointer hover:border-accent-400'
      )}
    >
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-medium text-surface-600">Slot {slotNumber}</span>
        <div className={clsx('w-2 h-2 rounded-full', dotColors[status])} />
      </div>
      <div className="text-xs text-surface-500 truncate">
        {sessionName || status}
      </div>
    </div>
  );
}
