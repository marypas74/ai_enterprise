"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const react_1 = __importStar(require("react"));
const react_syntax_highlighter_1 = require("react-syntax-highlighter");
const prism_1 = require("react-syntax-highlighter/dist/esm/styles/prism");
// VS Code-themed syntax highlighting style
const vsCodeTheme = {
    ...prism_1.vscDarkPlus,
    'pre[class*="language-"]': {
        ...prism_1.vscDarkPlus['pre[class*="language-"]'],
        background: 'var(--vscode-editor-background)',
        margin: 0,
        padding: '12px',
        fontSize: '13px',
        fontFamily: 'var(--vscode-editor-font-family, "Consolas", "Courier New", monospace)',
        lineHeight: '1.5',
        overflow: 'auto',
    },
    'code[class*="language-"]': {
        ...prism_1.vscDarkPlus['code[class*="language-"]'],
        background: 'transparent',
        fontFamily: 'var(--vscode-editor-font-family, "Consolas", "Courier New", monospace)',
    },
};
const CodeBlock = ({ language = 'text', children, onCopy, onRun, onApply, }) => {
    const [copied, setCopied] = (0, react_1.useState)(false);
    const handleCopy = (0, react_1.useCallback)(async () => {
        try {
            await navigator.clipboard.writeText(children);
            setCopied(true);
            onCopy?.(children);
            setTimeout(() => setCopied(false), 2000);
        }
        catch (err) {
            console.error('Failed to copy:', err);
        }
    }, [children, onCopy]);
    const handleRun = (0, react_1.useCallback)(() => {
        onRun?.(children, language);
    }, [children, language, onRun]);
    const handleApply = (0, react_1.useCallback)(() => {
        onApply?.(children, language);
    }, [children, language, onApply]);
    const isBashCommand = ['bash', 'sh', 'shell', 'zsh', 'terminal', 'cmd'].includes(language.toLowerCase());
    const isCodeFile = !isBashCommand && language !== 'text' && language !== '';
    return (<div className="code-block">
      <div className="code-header">
        <span className="code-language">{language || 'text'}</span>
        <div className="code-actions">
          <button className="code-action-btn" onClick={handleCopy} title={copied ? 'Copied!' : 'Copy code'}>
            {copied ? (<CheckIcon />) : (<CopyIcon />)}
            <span>{copied ? 'Copied!' : 'Copy'}</span>
          </button>

          {isBashCommand && onRun && (<button className="code-action-btn run" onClick={handleRun} title="Run in terminal">
              <PlayIcon />
              <span>Run</span>
            </button>)}

          {isCodeFile && onApply && (<button className="code-action-btn apply" onClick={handleApply} title="Apply to editor">
              <ApplyIcon />
              <span>Apply</span>
            </button>)}
        </div>
      </div>

      <react_syntax_highlighter_1.Prism language={language} style={vsCodeTheme} customStyle={{
            margin: 0,
            borderRadius: '0 0 6px 6px',
        }} showLineNumbers={children.split('\n').length > 5} lineNumberStyle={{
            minWidth: '2.5em',
            paddingRight: '1em',
            color: 'var(--vscode-editorLineNumber-foreground)',
            userSelect: 'none',
        }}>
        {children}
      </react_syntax_highlighter_1.Prism>
    </div>);
};
// Icon components
const CopyIcon = () => (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
  </svg>);
const CheckIcon = () => (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polyline points="20 6 9 17 4 12"/>
  </svg>);
const PlayIcon = () => (<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
    <polygon points="5 3 19 12 5 21 5 3"/>
  </svg>);
const ApplyIcon = () => (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/>
  </svg>);
exports.default = CodeBlock;
//# sourceMappingURL=CodeBlock.js.map