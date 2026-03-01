import clsx from 'clsx';

interface MetricCardProps {
  title: string;
  value: string | number;
  subtitle: string;
  icon: React.ReactNode;
  color: 'cyan' | 'magenta' | 'yellow' | 'red';
}

const colorClasses = {
  cyan: 'bg-primary-50 text-primary-600',
  magenta: 'bg-accent-50 text-accent-600',
  yellow: 'bg-highlight-50 text-highlight-600',
  red: 'bg-red-50 text-red-600',
};

export default function MetricCard({ title, value, subtitle, icon, color }: MetricCardProps) {
  return (
    <div className="bg-white rounded-xl border border-surface-200 p-4">
      <div className="flex items-center gap-3 mb-2">
        <div className={clsx('p-2 rounded-lg', colorClasses[color])}>
          {icon}
        </div>
        <span className="text-sm text-surface-500">{title}</span>
      </div>
      <div className="text-2xl font-bold text-surface-900">{value}</div>
      <div className="text-xs text-surface-500 mt-1">{subtitle}</div>
    </div>
  );
}
