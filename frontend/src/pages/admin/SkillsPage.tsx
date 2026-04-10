import { useState, useEffect } from 'react';
import { api } from '../../services/api';
import { getMyInstallations, type Installation } from '../../services/marketplaceApi';
import {
  Brain,
  Code,
  FileText,
  BarChart3,
  Search,
  Palette,
  Server,
  CheckCircle,
  Plus,
  Edit2,
  Trash2,
  Users,
  Zap,
  BookOpen,
  Store
} from 'lucide-react';

interface Skill {
  id: number;
  name: string;
  display_name: string;
  description: string;
  category: string;
  system_prompt: string;
  example_prompts: string[];
  required_tools: number[];
  is_default: boolean;
  is_active: boolean;
  user_count?: number;
}

interface SkillTemplate {
  id: number;
  name: string;
  display_name: string;
  description: string;
  skill_ids: number[];
  is_active: boolean;
}

const CATEGORY_ICONS: Record<string, any> = {
  coding: Code,
  writing: FileText,
  analysis: BarChart3,
  research: Search,
  creative: Palette,
  technical: Server,
  communication: Users,
  other: Brain
};

const CATEGORY_COLORS: Record<string, string> = {
  coding: 'bg-blue-100 text-blue-800',
  writing: 'bg-purple-100 text-purple-800',
  analysis: 'bg-green-100 text-green-800',
  research: 'bg-yellow-100 text-yellow-800',
  creative: 'bg-pink-100 text-pink-800',
  technical: 'bg-orange-100 text-orange-800',
  communication: 'bg-indigo-100 text-indigo-800',
  other: 'bg-gray-100 text-gray-800'
};

export default function SkillsPage() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [templates, setTemplates] = useState<SkillTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedSkill, setSelectedSkill] = useState<Skill | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [filterCategory, setFilterCategory] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');

  const [marketplaceSkillNames, setMarketplaceSkillNames] = useState<Set<string>>(new Set());

  const [formData, setFormData] = useState({
    name: '',
    display_name: '',
    description: '',
    category: 'other',
    system_prompt: '',
    example_prompts: [''],
    is_default: false,
    is_active: true
  });

  useEffect(() => {
    fetchSkills();
    fetchTemplates();
    fetchMarketplaceInstallations();
  }, []);

  const fetchMarketplaceInstallations = async () => {
    try {
      const response = await getMyInstallations({ limit: 200 });
      const installations: Installation[] = response.data?.data ?? [];
      const skillNames = new Set<string>(
        installations
          .filter(inst => inst.catalogItem?.type === 'skill')
          .map(inst => inst.catalogItem?.name ?? '')
          .filter(Boolean)
      );
      setMarketplaceSkillNames(skillNames);
    } catch (error) {
      // Marketplace may not be available; silently ignore
    }
  };

  const fetchSkills = async () => {
    try {
      const response = await api.get('/skills');
      setSkills(response.data);
    } catch (error) {
      console.error('Error fetching skills:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchTemplates = async () => {
    try {
      const response = await api.get('/skill-templates');
      setTemplates(response.data);
    } catch (error) {
      console.error('Error fetching templates:', error);
    }
  };

  const handleSaveSkill = async () => {
    try {
      const payload = {
        ...formData,
        example_prompts: formData.example_prompts.filter(p => p.trim())
      };

      if (selectedSkill) {
        await api.patch(`/skills/${selectedSkill.id}`, payload);
      } else {
        await api.post('/skills', payload);
      }

      fetchSkills();
      setIsEditing(false);
      setSelectedSkill(null);
      resetForm();
    } catch (error) {
      console.error('Error saving skill:', error);
    }
  };

  const handleDeleteSkill = async (id: number) => {
    if (!confirm('Sei sicuro di voler eliminare questa skill?')) return;

    try {
      await api.delete(`/skills/${id}`);
      fetchSkills();
      if (selectedSkill?.id === id) {
        setSelectedSkill(null);
      }
    } catch (error) {
      console.error('Error deleting skill:', error);
    }
  };

  const handleToggleActive = async (skill: Skill) => {
    try {
      await api.patch(`/skills/${skill.id}`, { is_active: !skill.is_active });
      fetchSkills();
    } catch (error) {
      console.error('Error toggling skill:', error);
    }
  };

  const resetForm = () => {
    setFormData({
      name: '',
      display_name: '',
      description: '',
      category: 'other',
      system_prompt: '',
      example_prompts: [''],
      is_default: false,
      is_active: true
    });
  };

  const startEdit = (skill: Skill) => {
    setSelectedSkill(skill);
    setFormData({
      name: skill.name,
      display_name: skill.display_name,
      description: skill.description || '',
      category: skill.category,
      system_prompt: skill.system_prompt || '',
      example_prompts: skill.example_prompts.length > 0 ? skill.example_prompts : [''],
      is_default: skill.is_default,
      is_active: skill.is_active
    });
    setIsEditing(true);
  };

  const addExamplePrompt = () => {
    setFormData({
      ...formData,
      example_prompts: [...formData.example_prompts, '']
    });
  };

  const updateExamplePrompt = (index: number, value: string) => {
    const updated = [...formData.example_prompts];
    updated[index] = value;
    setFormData({ ...formData, example_prompts: updated });
  };

  const removeExamplePrompt = (index: number) => {
    const updated = formData.example_prompts.filter((_, i) => i !== index);
    setFormData({ ...formData, example_prompts: updated.length > 0 ? updated : [''] });
  };

  const categories = ['all', ...Object.keys(CATEGORY_ICONS)];

  const filteredSkills = skills.filter(skill => {
    const matchesCategory = filterCategory === 'all' || skill.category === filterCategory;
    const matchesSearch = skill.display_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          skill.description?.toLowerCase().includes(searchTerm.toLowerCase());
    return matchesCategory && matchesSearch;
  });

  const groupedSkills = filteredSkills.reduce((acc, skill) => {
    if (!acc[skill.category]) acc[skill.category] = [];
    acc[skill.category].push(skill);
    return acc;
  }, {} as Record<string, Skill[]>);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="p-6 flex flex-col h-full">
      <div className="flex items-center justify-between flex-shrink-0">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Skills Management</h2>
          <p className="text-gray-500 mt-1">Gestisci le competenze AI disponibili per gli utenti</p>
        </div>
        <button
          onClick={() => {
            resetForm();
            setSelectedSkill(null);
            setIsEditing(true);
          }}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          <Plus size={20} />
          Nuova Skill
        </button>
      </div>

      {/* Filters */}
      <div className="flex gap-4 mt-6 flex-shrink-0">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
          <input
            type="text"
            placeholder="Cerca skills..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>
        <select
          value={filterCategory}
          onChange={(e) => setFilterCategory(e.target.value)}
          className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
        >
          {categories.map(cat => (
            <option key={cat} value={cat}>
              {cat === 'all' ? 'Tutte le categorie' : cat.charAt(0).toUpperCase() + cat.slice(1)}
            </option>
          ))}
        </select>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto mt-6">
      {/* Skills Grid */}
      {Object.keys(groupedSkills).length === 0 ? (
        <div className="flex items-center justify-center h-64 bg-white rounded-lg border-2 border-dashed border-gray-300">
          <div className="text-center">
            <Brain className="w-12 h-12 text-gray-400 mx-auto mb-3" />
            <p className="text-gray-600 font-medium">Nessuna skill trovata</p>
            <p className="text-gray-500 text-sm mt-1">Crea la tua prima skill per iniziare</p>
          </div>
        </div>
      ) : (
      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
        {Object.entries(groupedSkills).map(([category, categorySkills]) => (
          <div key={category} className="col-span-full">
            <h3 className="text-lg font-semibold text-gray-700 mb-3 flex items-center gap-2">
              {(() => {
                const Icon = CATEGORY_ICONS[category] || Brain;
                return <Icon size={20} />;
              })()}
              {category.charAt(0).toUpperCase() + category.slice(1)}
              <span className="text-sm font-normal text-gray-500">({categorySkills.length})</span>
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {categorySkills.map(skill => (
                <div
                  key={skill.id}
                  className={`bg-white rounded-lg shadow-sm border p-4 hover:shadow-md transition-shadow ${
                    !skill.is_active ? 'opacity-60' : ''
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      {(() => {
                        const Icon = CATEGORY_ICONS[skill.category] || Brain;
                        return (
                          <div className={`p-2 rounded-lg ${CATEGORY_COLORS[skill.category]}`}>
                            <Icon size={20} />
                          </div>
                        );
                      })()}
                      <div>
                        <h4 className="font-medium text-gray-900">{skill.display_name}</h4>
                        <p className="text-sm text-gray-500">{skill.name}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      {marketplaceSkillNames.has(skill.name) && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs bg-blue-100 text-blue-700 rounded-full">
                          <Store size={10} />
                          Marketplace
                        </span>
                      )}
                      {skill.is_default && (
                        <span className="px-2 py-0.5 text-xs bg-green-100 text-green-700 rounded-full">
                          Default
                        </span>
                      )}
                    </div>
                  </div>

                  <p className="text-sm text-gray-600 mt-3 line-clamp-2">
                    {skill.description || 'Nessuna descrizione'}
                  </p>

                  {skill.example_prompts.length > 0 && (
                    <div className="mt-3">
                      <p className="text-xs text-gray-500 mb-1">Esempi:</p>
                      <div className="flex flex-wrap gap-1">
                        {skill.example_prompts.slice(0, 2).map((prompt, i) => (
                          <span
                            key={i}
                            className="text-xs px-2 py-1 bg-gray-100 text-gray-600 rounded-full truncate max-w-[200px]"
                          >
                            {prompt}
                          </span>
                        ))}
                        {skill.example_prompts.length > 2 && (
                          <span className="text-xs text-gray-400">
                            +{skill.example_prompts.length - 2}
                          </span>
                        )}
                      </div>
                    </div>
                  )}

                  <div className="flex items-center justify-between mt-4 pt-3 border-t">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={skill.is_active}
                        onChange={() => handleToggleActive(skill)}
                        className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      />
                      <span className="text-sm text-gray-600">Attiva</span>
                    </label>
                    <div className="flex gap-2">
                      <button
                        onClick={() => startEdit(skill)}
                        className="p-1.5 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded"
                      >
                        <Edit2 size={16} />
                      </button>
                      <button
                        onClick={() => handleDeleteSkill(skill.id)}
                        className="p-1.5 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      )}

      {/* Skill Templates */}
      {templates.length > 0 && (
        <div className="mt-8">
          <h3 className="text-lg font-semibold text-gray-700 mb-4 flex items-center gap-2">
            <BookOpen size={20} />
            Template di Skills
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {templates.map(template => (
              <div key={template.id} className="bg-white rounded-lg shadow-sm border p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Zap className="text-yellow-500" size={20} />
                  <h4 className="font-medium">{template.display_name}</h4>
                </div>
                <p className="text-sm text-gray-600 mb-3">{template.description}</p>
                <p className="text-xs text-gray-500">
                  {template.skill_ids.length} skills incluse
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      </div>

      {/* Edit Modal */}
      {isEditing && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b">
              <h3 className="text-xl font-semibold">
                {selectedSkill ? 'Modifica Skill' : 'Nuova Skill'}
              </h3>
            </div>
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Nome (identificatore)
                  </label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value.toLowerCase().replace(/\s+/g, '_') })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    placeholder="coding_assistant"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Nome visualizzato
                  </label>
                  <input
                    type="text"
                    value={formData.display_name}
                    onChange={(e) => setFormData({ ...formData, display_name: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    placeholder="Coding Assistant"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Categoria
                </label>
                <select
                  value={formData.category}
                  onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                >
                  {Object.keys(CATEGORY_ICONS).map(cat => (
                    <option key={cat} value={cat}>
                      {cat.charAt(0).toUpperCase() + cat.slice(1)}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Descrizione
                </label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  rows={2}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  placeholder="Descrizione della skill..."
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  System Prompt
                </label>
                <textarea
                  value={formData.system_prompt}
                  onChange={(e) => setFormData({ ...formData, system_prompt: e.target.value })}
                  rows={4}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 font-mono text-sm"
                  placeholder="You are an expert..."
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Prompt di esempio
                </label>
                <div className="space-y-2">
                  {formData.example_prompts.map((prompt, index) => (
                    <div key={index} className="flex gap-2">
                      <input
                        type="text"
                        value={prompt}
                        onChange={(e) => updateExamplePrompt(index, e.target.value)}
                        className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                        placeholder="Esempio di prompt..."
                      />
                      <button
                        onClick={() => removeExamplePrompt(index)}
                        className="px-3 py-2 text-red-600 hover:bg-red-50 rounded-lg"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  ))}
                  <button
                    onClick={addExamplePrompt}
                    className="text-sm text-blue-600 hover:text-blue-700"
                  >
                    + Aggiungi esempio
                  </button>
                </div>
              </div>

              <div className="flex gap-4">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={formData.is_default}
                    onChange={(e) => setFormData({ ...formData, is_default: e.target.checked })}
                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="text-sm text-gray-700">Skill di default per nuovi utenti</span>
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={formData.is_active}
                    onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="text-sm text-gray-700">Attiva</span>
                </label>
              </div>
            </div>
            <div className="p-6 border-t flex justify-end gap-3">
              <button
                onClick={() => {
                  setIsEditing(false);
                  setSelectedSkill(null);
                  resetForm();
                }}
                className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Annulla
              </button>
              <button
                onClick={handleSaveSkill}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              >
                {selectedSkill ? 'Salva Modifiche' : 'Crea Skill'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
