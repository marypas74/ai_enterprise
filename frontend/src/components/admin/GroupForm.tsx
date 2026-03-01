import { useState } from 'react';

export interface Group {
  id: number;
  name: string;
  description?: string;
  max_tokens_per_month: number;
  kanban_enabled: boolean;
  is_active: boolean;
  created_at: string;
  user_count?: number;
}

interface GroupFormProps {
  group?: Group;
  onSave: (data: any) => void;
  onCancel: () => void;
}

export default function GroupForm({ group, onSave, onCancel }: GroupFormProps) {
  const [formData, setFormData] = useState({
    name: group?.name || '',
    description: group?.description || '',
    max_tokens_per_month: group?.max_tokens_per_month || 1000000,
    kanban_enabled: group?.kanban_enabled ?? true,
    is_active: group?.is_active ?? true,
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(formData);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium mb-1">Nome Gruppo</label>
        <input
          type="text"
          value={formData.name}
          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          className="input w-full"
          required
        />
      </div>
      <div>
        <label className="block text-sm font-medium mb-1">Descrizione</label>
        <textarea
          value={formData.description}
          onChange={(e) => setFormData({ ...formData, description: e.target.value })}
          className="input w-full"
          rows={3}
        />
      </div>
      <div>
        <label className="block text-sm font-medium mb-1">Token Mensili Max</label>
        <input
          type="number"
          value={formData.max_tokens_per_month}
          onChange={(e) => setFormData({ ...formData, max_tokens_per_month: parseInt(e.target.value) })}
          className="input w-full"
        />
      </div>
      <div className="flex items-center gap-4">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={formData.kanban_enabled}
            onChange={(e) => setFormData({ ...formData, kanban_enabled: e.target.checked })}
            className="rounded"
          />
          <span className="text-sm">Accesso Kanban</span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={formData.is_active}
            onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
            className="rounded"
          />
          <span className="text-sm">Gruppo attivo</span>
        </label>
      </div>
      <div className="flex gap-2 pt-4">
        <button type="button" onClick={onCancel} className="btn btn-secondary flex-1">
          Annulla
        </button>
        <button type="submit" className="btn btn-primary flex-1">
          {group ? 'Aggiorna' : 'Crea'}
        </button>
      </div>
    </form>
  );
}
