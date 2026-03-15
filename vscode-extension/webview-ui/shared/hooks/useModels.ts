import { useState, useCallback } from 'react';

interface AIModel {
  id: string;
  name: string;
  provider: string;
}

export function useModels() {
  const [models, setModels] = useState<AIModel[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>('');

  const updateModels = useCallback((newModels: AIModel[]) => {
    setModels(newModels);
    if (newModels.length > 0 && !selectedModel) {
      setSelectedModel(newModels[0].id);
    }
  }, [selectedModel]);

  return { models, selectedModel, setSelectedModel, updateModels };
}
