import React from 'react';
import { MessageSquare, Library } from 'lucide-react';
import { useDocumentStore, ChatMode } from '../../hooks/useDocumentStore';

/**
 * Chat mode toggle: "Chat Libera" ↔ "Chiedi ai Documenti"
 * Renders as a segmented pill control.
 */
interface RagModeToggleProps {
    onModeChange?: (mode: ChatMode) => void;
}

export function RagModeToggle({ onModeChange }: RagModeToggleProps) {
    const { chatMode, setChatMode } = useDocumentStore();

    const modes: { value: ChatMode; label: string; Icon: React.FC<any> }[] = [
        { value: 'free', label: 'Chat Libera', Icon: MessageSquare },
        { value: 'rag', label: 'Chiedi ai Documenti', Icon: Library },
    ];

    return (
        <div
            className="inline-flex items-center gap-0.5 bg-gray-100 dark:bg-gray-800 rounded-full p-0.5"
            role="group"
            aria-label="Modalità chat"
        >
            {modes.map(({ value, label, Icon }) => (
                <button
                    key={value}
                    id={`rag-mode-${value}`}
                    onClick={() => {
                        setChatMode(value);
                        if (onModeChange) onModeChange(value);
                    }}
                    className={`
            inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium
            transition-all duration-150 select-none whitespace-nowrap
            ${chatMode === value
                            ? value === 'rag'
                                ? 'bg-indigo-600 text-white shadow-sm'
                                : 'bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 shadow-sm'
                            : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
                        }
          `}
                    aria-pressed={chatMode === value}
                >
                    <Icon className="w-3.5 h-3.5" />
                    {label}
                </button>
            ))}
        </div>
    );
}
