import React from 'react';

// Bot icon types
export type BotIconType = 'default' | 'purple' | 'sparkle' | 'brain' | 'chat' | 'robot';

interface BotIconProps {
    type?: BotIconType;
    className?: string;
    size?: number;
}

// Default AI globe icon
const DefaultIcon: React.FC<{ size: number }> = ({ size }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z" />
    </svg>
);

// Purple robot icon
const PurpleRobotIcon: React.FC<{ size: number }> = ({ size }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
        <rect x="4" y="8" width="16" height="12" rx="3" />
        <rect x="8" y="4" width="8" height="4" rx="1" />
        <circle cx="9" cy="13" r="1.5" fill="var(--vscode-editor-background, white)" />
        <circle cx="15" cy="13" r="1.5" fill="var(--vscode-editor-background, white)" />
        <rect x="10" y="16" width="4" height="2" rx="1" fill="var(--vscode-editor-background, white)" />
    </svg>
);

// Sparkle AI icon
const SparkleIcon: React.FC<{ size: number }> = ({ size }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 2L13.09 8.26L18 6L14.74 10.91L21 12L14.74 13.09L18 18L13.09 15.74L12 22L10.91 15.74L6 18L9.26 13.09L3 12L9.26 10.91L6 6L10.91 8.26L12 2Z" />
    </svg>
);

// Brain neural network icon
const BrainIcon: React.FC<{ size: number }> = ({ size }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 2C9.5 2 7.4 3.6 6.6 5.8C4.5 6.3 3 8.1 3 10.3C3 11.4 3.4 12.5 4.1 13.3C3.4 14.2 3 15.3 3 16.5C3 18.7 4.5 20.6 6.6 21C7.4 21.4 8.6 21.6 10 21.6C10 21.6 11 22 12 22C13 22 14 21.6 14 21.6C15.4 21.6 16.6 21.4 17.4 21C19.5 20.6 21 18.7 21 16.5C21 15.3 20.6 14.2 19.9 13.3C20.6 12.5 21 11.4 21 10.3C21 8.1 19.5 6.3 17.4 5.8C16.6 3.6 14.5 2 12 2ZM12 4C13.9 4 15.4 5.3 15.9 7H14.5C14.2 6.4 13.6 6 13 6H11C10.4 6 9.8 6.4 9.5 7H8.1C8.6 5.3 10.1 4 12 4ZM8 10C8.6 10 9 10.4 9 11S8.6 12 8 12 7 11.6 7 11 7.4 10 8 10ZM16 10C16.6 10 17 10.4 17 11S16.6 12 16 12 15 11.6 15 11 15.4 10 16 10ZM12 14C13.1 14 14 14.9 14 16H10C10 14.9 10.9 14 12 14Z" />
    </svg>
);

// Chat bubble icon
const ChatIcon: React.FC<{ size: number }> = ({ size }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
        <path d="M20 2H4C2.9 2 2 2.9 2 4V22L6 18H20C21.1 18 22 17.1 22 16V4C22 2.9 21.1 2 20 2ZM8 14H6V12H8V14ZM8 11H6V9H8V11ZM8 8H6V6H8V8ZM15 14H10V12H15V14ZM18 11H10V9H18V11ZM18 8H10V6H18V8Z" />
    </svg>
);

// Robot head icon
const RobotIcon: React.FC<{ size: number }> = ({ size }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 2a2 2 0 0 1 2 2c0 .74-.4 1.39-1 1.73V7h1a7 7 0 0 1 7 7h1a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-1v1a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-1H2a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1h1a7 7 0 0 1 7-7h1V5.73c-.6-.34-1-.99-1-1.73a2 2 0 0 1 2-2M7.5 13A2.5 2.5 0 0 0 5 15.5 2.5 2.5 0 0 0 7.5 18a2.5 2.5 0 0 0 2.5-2.5A2.5 2.5 0 0 0 7.5 13m9 0a2.5 2.5 0 0 0-2.5 2.5 2.5 2.5 0 0 0 2.5 2.5 2.5 2.5 0 0 0 2.5-2.5 2.5 2.5 0 0 0-2.5-2.5Z" />
    </svg>
);

// Main BotIcon component
export const BotIcon: React.FC<BotIconProps> = ({ type = 'default', className = '', size = 16 }) => {
    const iconMap: Record<BotIconType, React.FC<{ size: number }>> = {
        default: DefaultIcon,
        purple: PurpleRobotIcon,
        sparkle: SparkleIcon,
        brain: BrainIcon,
        chat: ChatIcon,
        robot: RobotIcon,
    };

    const IconComponent = iconMap[type] || DefaultIcon;

    return (
        <span className={className}>
            <IconComponent size={size} />
        </span>
    );
};

// Icon metadata
export const BOT_ICONS: { type: BotIconType; name: string }[] = [
    { type: 'default', name: 'Globe' },
    { type: 'purple', name: 'Robot' },
    { type: 'sparkle', name: 'Sparkle' },
    { type: 'brain', name: 'Brain' },
    { type: 'chat', name: 'Chat' },
    { type: 'robot', name: 'Android' },
];

export default BotIcon;
