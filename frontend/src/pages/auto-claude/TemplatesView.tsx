import { useState, useEffect } from 'react';
import { useAgentStore } from '../../hooks/useAgentStore';
import { Plus, Trash2 } from 'lucide-react';
import clsx from 'clsx';

const categoryColors: Record<string, string> = {
  development: 'bg-blue-100 text-blue-700',
  testing: 'bg-green-100 text-green-700',
  documentation: 'bg-purple-100 text-purple-700',
  research: 'bg-amber-100 text-amber-700',
  automation: 'bg-red-100 text-red-700',
  custom: 'bg-gray-100 text-gray-700',
};

export default function TemplatesView() {
  const { templates, fetchTemplates, deleteTemplate } = useAgentStore();
  const [showCreate, setShowCreate] = useState(false);

  useEffect(() => {
    fetchTemplates();
  }, []);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-surface-900">Agent Templates</h2>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-3 py-2 text-sm bg-primary-500 text-white rounded-lg hover:bg-primary-600"
        >
          <Plus className="w-4 h-4" />
          Create Template
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {templates.map(template => (
          <div key={template.id} className="bg-white rounded-lg border border-surface-200 p-4">
            <div className="flex items-start justify-between mb-2">
              <h4 className="font-medium text-surface-900">{template.name}</h4>
              <span className={clsx(
                'px-2 py-0.5 text-xs rounded-full capitalize',
                categoryColors[template.category] || categoryColors.custom
              )}>
                {template.category}
              </span>
            </div>
            {template.description && (
              <p className="text-sm text-surface-500 mb-3 line-clamp-2">{template.description}</p>
            )}
            <div className="flex items-center justify-between text-xs text-surface-400">
              <span>{template.isPublic ? 'Public' : 'Private'}</span>
              <button
                onClick={() => deleteTemplate(template.id)}
                className="text-red-500 hover:text-red-700"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
