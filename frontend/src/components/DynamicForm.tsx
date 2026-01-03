import { useForm } from 'react-hook-form';
import { Eye, EyeOff } from 'lucide-react';
import { useState } from 'react';
import clsx from 'clsx';

interface SchemaProperty {
  type: string;
  title: string;
  description?: string;
  default?: string | number | boolean;
  format?: string;
  enum?: string[];
  minimum?: number;
  maximum?: number;
}

interface JSONSchema {
  type: 'object';
  required?: string[];
  properties: Record<string, SchemaProperty>;
}

interface DynamicFormProps {
  schema: JSONSchema;
  initialValues?: Record<string, any>;
  onSubmit: (values: Record<string, any>) => Promise<void>;
  submitLabel?: string;
  loading?: boolean;
}

export default function DynamicForm({
  schema,
  initialValues = {},
  onSubmit,
  submitLabel = 'Save',
  loading = false
}: DynamicFormProps) {
  const { register, handleSubmit, formState: { errors } } = useForm({
    defaultValues: Object.entries(schema.properties).reduce((acc, [key, prop]) => {
      acc[key] = initialValues[key] ?? prop.default ?? '';
      return acc;
    }, {} as Record<string, any>)
  });

  const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({});

  const toggleSecret = (key: string) => {
    setShowSecrets(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const renderField = (key: string, prop: SchemaProperty) => {
    const isRequired = schema.required?.includes(key);
    const isPassword = prop.format === 'password';
    const error = errors[key];

    // Boolean/checkbox
    if (prop.type === 'boolean') {
      return (
        <div key={key} className="flex items-center gap-3">
          <input
            type="checkbox"
            id={key}
            {...register(key)}
            className="w-4 h-4 rounded border-surface-300 text-primary-600 focus:ring-primary-500"
          />
          <label htmlFor={key} className="text-sm font-medium">
            {prop.title}
          </label>
          {prop.description && (
            <span className="text-xs text-surface-500">{prop.description}</span>
          )}
        </div>
      );
    }

    // Enum/select
    if (prop.enum) {
      return (
        <div key={key} className="space-y-1.5">
          <label htmlFor={key} className="block text-sm font-medium">
            {prop.title}
            {isRequired && <span className="text-red-500 ml-1">*</span>}
          </label>
          <select
            id={key}
            {...register(key, { required: isRequired })}
            className="input"
          >
            <option value="">Select...</option>
            {prop.enum.map(opt => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
          {prop.description && (
            <p className="text-xs text-surface-500">{prop.description}</p>
          )}
          {error && <p className="text-xs text-red-500">This field is required</p>}
        </div>
      );
    }

    // Number
    if (prop.type === 'number' || prop.type === 'integer') {
      return (
        <div key={key} className="space-y-1.5">
          <label htmlFor={key} className="block text-sm font-medium">
            {prop.title}
            {isRequired && <span className="text-red-500 ml-1">*</span>}
          </label>
          <input
            type="number"
            id={key}
            {...register(key, {
              required: isRequired,
              valueAsNumber: true,
              min: prop.minimum,
              max: prop.maximum
            })}
            className="input"
            placeholder={prop.description}
            min={prop.minimum}
            max={prop.maximum}
          />
          {prop.description && (
            <p className="text-xs text-surface-500">{prop.description}</p>
          )}
          {error && <p className="text-xs text-red-500">This field is required</p>}
        </div>
      );
    }

    // Password/secret
    if (isPassword) {
      return (
        <div key={key} className="space-y-1.5">
          <label htmlFor={key} className="block text-sm font-medium">
            {prop.title}
            {isRequired && <span className="text-red-500 ml-1">*</span>}
          </label>
          <div className="relative">
            <input
              type={showSecrets[key] ? 'text' : 'password'}
              id={key}
              {...register(key, { required: isRequired })}
              className="input pr-10"
              placeholder={prop.description}
              autoComplete="off"
            />
            <button
              type="button"
              onClick={() => toggleSecret(key)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-surface-400 hover:text-surface-600"
            >
              {showSecrets[key] ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          {prop.description && (
            <p className="text-xs text-surface-500">{prop.description}</p>
          )}
          {error && <p className="text-xs text-red-500">This field is required</p>}
        </div>
      );
    }

    // Default: text input
    return (
      <div key={key} className="space-y-1.5">
        <label htmlFor={key} className="block text-sm font-medium">
          {prop.title}
          {isRequired && <span className="text-red-500 ml-1">*</span>}
        </label>
        <input
          type="text"
          id={key}
          {...register(key, { required: isRequired })}
          className="input"
          placeholder={prop.description || prop.default?.toString()}
        />
        {prop.description && (
          <p className="text-xs text-surface-500">{prop.description}</p>
        )}
        {error && <p className="text-xs text-red-500">This field is required</p>}
      </div>
    );
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      {Object.entries(schema.properties).map(([key, prop]) => renderField(key, prop))}

      <div className="pt-4 border-t border-surface-200 dark:border-surface-700">
        <button
          type="submit"
          disabled={loading}
          className={clsx(
            'btn btn-primary w-full',
            loading && 'opacity-50 cursor-not-allowed'
          )}
        >
          {loading ? 'Saving...' : submitLabel}
        </button>
      </div>
    </form>
  );
}
