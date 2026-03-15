import React, { useMemo } from 'react';

interface Model {
  id: string;
  name: string;
  provider: string;
}

interface ModelPickerProps {
  models: Model[];
  selected: string;
  onChange: (id: string) => void;
}

export const ModelPicker: React.FC<ModelPickerProps> = ({ models, selected, onChange }) => {
  const grouped = useMemo(() => {
    const groups: Record<string, Model[]> = {};
    for (const model of models) {
      const key = model.provider;
      if (!groups[key]) { groups[key] = []; }
      groups[key].push(model);
    }
    return groups;
  }, [models]);

  if (models.length === 0) {
    return null;
  }

  return (
    <select
      value={selected}
      onChange={(e) => onChange(e.target.value)}
      style={{
        background: 'var(--input-bg)',
        color: 'var(--input-text)',
        border: '1px solid var(--input-border)',
        borderRadius: '4px',
        padding: '4px 8px',
        fontSize: 'inherit',
        cursor: 'pointer',
        maxWidth: '200px',
      }}
    >
      {Object.entries(grouped).map(([provider, providerModels]) => (
        <optgroup key={provider} label={provider}>
          {providerModels.map((model) => (
            <option key={model.id} value={model.id}>
              {model.name}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
};
