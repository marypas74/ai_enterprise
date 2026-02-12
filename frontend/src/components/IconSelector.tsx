import React, { useState, useEffect, useRef } from 'react';
import { BotIcon, BOT_ICONS, BotIconType } from './BotIcon';
import { ChevronDown, Check } from 'lucide-react';

const STORAGE_KEY = 'enterprise-ai-chat-bot-icon';

interface IconSelectorProps {
    onIconChange?: (iconType: BotIconType) => void;
}

export const useSelectedIcon = (): [BotIconType, (icon: BotIconType) => void] => {
    const [selectedIcon, setSelectedIcon] = useState<BotIconType>(() => {
        if (typeof window !== 'undefined') {
            return (localStorage.getItem(STORAGE_KEY) as BotIconType) || 'default';
        }
        return 'default';
    });

    const saveIcon = (icon: BotIconType) => {
        setSelectedIcon(icon);
        localStorage.setItem(STORAGE_KEY, icon);
    };

    return [selectedIcon, saveIcon];
};

export const IconSelector: React.FC<IconSelectorProps> = ({ onIconChange }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [selectedIcon, setSelectedIcon] = useSelectedIcon();
    const dropdownRef = useRef<HTMLDivElement>(null);

    // Close dropdown when clicking outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const handleSelect = (iconType: BotIconType) => {
        setSelectedIcon(iconType);
        onIconChange?.(iconType);
        setIsOpen(false);
    };

    const currentIcon = BOT_ICONS.find(i => i.type === selectedIcon) || BOT_ICONS[0];

    return (
        <div className="relative" ref={dropdownRef}>
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors border border-surface-200 dark:border-surface-700"
                title="Change AI icon"
            >
                <div className="w-6 h-6 rounded bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center text-white">
                    <BotIcon type={selectedIcon} size={16} />
                </div>
                <span className="text-sm font-medium hidden sm:inline">{currentIcon.name}</span>
                <ChevronDown className={`w-4 h-4 text-surface-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
            </button>

            {isOpen && (
                <div className="absolute top-full right-0 mt-2 w-64 bg-white dark:bg-surface-900 rounded-xl shadow-xl border border-surface-200 dark:border-surface-700 p-2 z-50">
                    <div className="px-3 py-2 text-xs font-semibold text-surface-500 uppercase tracking-wider">
                        AI Avatar Style
                    </div>
                    <div className="grid grid-cols-3 gap-2 p-2">
                        {BOT_ICONS.map((icon) => (
                            <button
                                key={icon.type}
                                onClick={() => handleSelect(icon.type)}
                                className={`flex flex-col items-center gap-2 p-3 rounded-lg transition-all ${selectedIcon === icon.type
                                        ? 'bg-primary-100 dark:bg-primary-900/30 ring-2 ring-primary-500'
                                        : 'hover:bg-surface-100 dark:hover:bg-surface-800'
                                    }`}
                                title={icon.description}
                            >
                                <div className={`w-10 h-10 rounded-lg flex items-center justify-center text-white ${selectedIcon === icon.type
                                        ? 'bg-gradient-to-br from-violet-500 to-purple-600'
                                        : 'bg-gradient-to-br from-surface-400 to-surface-500 dark:from-surface-600 dark:to-surface-700'
                                    }`}>
                                    <BotIcon type={icon.type} size={24} />
                                </div>
                                <span className="text-xs font-medium truncate w-full text-center">{icon.name}</span>
                                {selectedIcon === icon.type && (
                                    <Check className="w-4 h-4 text-primary-500 absolute top-1 right-1" />
                                )}
                            </button>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};

export default IconSelector;
