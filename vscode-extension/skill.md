# Skills - VS Code Extension Development

## Lezioni Apprese

### 1. Bundling Dipendenze con Webpack
**Problema**: Le estensioni VS Code non includono automaticamente `node_modules` nel pacchetto VSIX.
**Soluzione**: Usare webpack per bundlare tutte le dipendenze (axios, ecc.) in un unico file.

```javascript
// webpack.config.js
module.exports = {
    target: 'node',
    externals: { vscode: 'commonjs vscode' }, // vscode è fornito a runtime
    // ... resto della configurazione
};
```

### 2. Mapping Campi API
**Problema**: Il backend può restituire campi con nomi diversi da quelli attesi.
**Soluzione**: Usare mapping flessibile con fallback:

```typescript
availableModels = rawModels.map((m: any) => ({
    id: m.id || m.model_id || 'unknown',
    name: m.name || m.display_name || m.id || 'Unknown Model',
    provider: m.provider || m.provider_type || 'unknown'
}));
```

### 3. Content Security Policy (CSP) per Webview
**Problema**: Le webview VS Code richiedono CSP corretto per eseguire script.
**Soluzione**: Usare nonce per gli script inline:

```typescript
const nonce = getNonce();
return `<meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<script nonce="${nonce}">...</script>`;
```

### 4. ExtensionKind per SSH Remote
**Problema**: Estensioni con webview potrebbero non funzionare correttamente in VS Code Remote SSH.
**Soluzione**: Specificare `extensionKind` in package.json:

```json
"extensionKind": ["ui", "workspace"]
```

### 5. Icone per Estensioni
**Problema**: VS Code marketplace richiede icone PNG (non SVG).
**Soluzione**:
- Creare icona SVG
- Convertire a PNG 128x128 con `rsvg-convert -w 128 -h 128 icon.svg -o icon.png`
- Specificare in package.json: `"icon": "resources/icon.png"`

### 6. View Type Webview
**Problema**: `resolveWebviewView` non viene chiamato se il tipo view non è specificato.
**Soluzione**: Aggiungere `"type": "webview"` nella definizione della view:

```json
"views": {
    "myContainer": [{
        "type": "webview",
        "id": "myView",
        "name": "My View"
    }]
}
```

### 7. Activation Events
**Problema**: VS Code moderno auto-genera activationEvents dai contribution points.
**Soluzione**: Rimuovere activationEvents ridondanti da package.json (VS Code li genera automaticamente).

### 8. Debug Output Channel
**Problema**: Difficile debuggare estensioni senza log visibili.
**Soluzione**: Creare output channel e usare `outputChannel.show()` per forzare visualizzazione:

```typescript
outputChannel = vscode.window.createOutputChannel('My Extension');
outputChannel.show();
outputChannel.appendLine('Debug message');
```

### 9. Axios Response Types
**Problema**: TypeScript può non inferire correttamente i tipi di risposta Axios.
**Soluzione**: Usare `any` per il mapping iniziale e tipizzare dopo:

```typescript
const response = await api.get('/endpoint');
const data = response.data as MyType[];
```

### 10. Autenticazione Header
**Problema**: Header Authorization potrebbe non essere inviato correttamente.
**Soluzione**: Passare esplicitamente l'header in ogni richiesta:

```typescript
const response = await api.post('/endpoint', data, {
    headers: { 'Authorization': `Bearer ${token}` }
});
```

### 11. Editor Toolbar Button (come Claude Code)
**Problema**: Vuoi aggiungere un pulsante nella barra degli strumenti dell'editor.
**Soluzione**: Aggiungere `editor/title` menu in package.json:

```json
"menus": {
    "editor/title": [{
        "command": "my-extension.openChat",
        "group": "navigation",
        "when": "editorTextFocus"
    }]
}
```

### 12. Status Bar Item Personalizzato
**Problema**: Mostrare un item nella status bar come Claude Code.
**Soluzione**: Creare StatusBarItem con stile prominente:

```typescript
const statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100
);
statusBarItem.text = '$(cloud) My Extension: Open';
statusBarItem.tooltip = 'Click per aprire (Ctrl+Shift+L)';
statusBarItem.command = 'my-extension.openChat';
statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.prominentBackground');
statusBarItem.show();
```

### 13. React Error Handling con UI Visibile
**Problema**: Gli errori API vengono solo loggati in console, non visibili all'utente.
**Soluzione**: Aggiungere stato per gli errori e mostrare banner visibili:

```typescript
const [apiError, setApiError] = useState<string | null>(null);

const loadData = async () => {
    setApiError(null);
    try {
        console.log('[Component] Loading from /api/endpoint...');
        const response = await api.get('/endpoint');
        console.log('[Component] Response:', response.data);
        setData(response.data || []);
    } catch (err: any) {
        const errorMsg = `[API Error] ${err.response?.status || 'Network'}: ${err.response?.data?.error || err.message}`;
        console.error('[Component] Failed:', errorMsg, err);
        setApiError(errorMsg);
    }
};

// Nel JSX:
{apiError && (
    <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
        <h4 className="font-medium text-red-800">Errore</h4>
        <p className="text-sm text-red-600 font-mono">{apiError}</p>
        <button onClick={loadData}>Riprova</button>
    </div>
)}
```

### 14. Evitare Demo Data in Produzione
**Problema**: Dati demo hardcoded nel catch degli errori API inquinano i dati reali.
**Soluzione**: NON inserire mai dati demo come fallback. Usare array vuoti e mostrare errori:

```typescript
// SBAGLIATO - dati demo nel catch
} catch (err) {
    setData([{ id: 1, name: 'Demo Item' }]); // NO!
}

// CORRETTO - mostra errore e array vuoto
} catch (err: any) {
    setApiError(`Error: ${err.message}`);
    setData([]); // Array vuoto, no demo data
}
```

### 15. Coesistenza con GitHub Copilot
**Problema**: L'estensione deve funzionare senza conflitti con GitHub Copilot.
**Soluzione**: Applicare queste best practice:

**1. Activation Events per Lazy Loading (~30x più veloce all'avvio):**
```json
"activationEvents": [
    "onView:my-extension.chatView",
    "onCommand:my-extension.openChat"
]
```

**2. Copilot Detection all'attivazione:**
```typescript
const copilotExtension = vscode.extensions.getExtension('GitHub.copilot');
const copilotChat = vscode.extensions.getExtension('GitHub.copilot-chat');
if (copilotExtension || copilotChat) {
    outputChannel.appendLine('GitHub Copilot detected - coexistence mode');
}
```

**3. Keyboard Shortcuts Non-Conflittuali:**
- Copilot usa: `Ctrl+Alt+I`, `Ctrl+I`, `Alt+[/]`
- La tua estensione: usa shortcuts diversi come `Ctrl+Shift+L`

**4. Status Bar Condizionale:**
```typescript
const updateStatusBar = () => {
    if (accessToken && currentUser) {
        statusBarItem.text = `$(cloud) ${currentUser.name}: Chat`;
        statusBarItem.show();
    } else {
        statusBarItem.text = '$(cloud) My Extension: Login';
        statusBarItem.show();
    }
};
```

**Fonti:**
- https://code.visualstudio.com/api/references/activation-events
- https://code.visualstudio.com/docs/copilot/overview

### 16. Notifiche Kanban nel VS Code Extension
**Problema**: Mostrare notifiche Kanban (card assegnate, spostate) nel pannello chat VS Code.
**Soluzione**: Implementare polling con fetch periodico:

```typescript
private _notifications: KanbanNotification[] = [];
private _notificationInterval?: NodeJS.Timeout;

public startNotificationPolling() {
    this._notificationInterval = setInterval(() => {
        this._fetchNotifications();
    }, 30000); // Poll ogni 30 secondi
}

private async _fetchNotifications() {
    const response = await api.get('/notifications');
    const newNotifications = response.data || [];

    // Mostra VS Code notification per nuovi elementi
    const unreadNew = newNotifications.filter(n => !n.read);
    for (const notif of unreadNew) {
        vscode.window.showInformationMessage(
            `${this._getIcon(notif.type)} ${notif.message}`,
            'Visualizza'
        );
    }
}
```

### 17. Allineare Modelli Frontend e Client con Provider Abilitati
**Problema**: I modelli mostrati nel client (VS Code extension) non corrispondono ai provider abilitati nel frontend admin.
**Causa**: La query SQL nel backend restituiva modelli da tutti i provider, non solo quelli con API key configurata.
**Soluzione**: Usare una query con JOIN esplicito su `ai_provider_settings` per filtrare solo modelli da provider configurati:

```sql
SELECT DISTINCT m.model_id, m.display_name, p.provider_type
FROM ai_models m
JOIN ai_providers p ON m.provider_id = p.id
JOIN ai_provider_settings ps ON ps.provider_id = p.id
WHERE m.is_enabled = TRUE
  AND p.is_enabled = TRUE
  AND ps.setting_key IN ('api_key', 'oauth_token')
  AND ps.setting_value IS NOT NULL
  AND ps.setting_value != ''
  AND TRIM(ps.setting_value) != ''
ORDER BY p.provider_type, m.sort_order, m.display_name
```

**Best Practice** ([fonte](https://cloudsecurityalliance.org/blog/2025/09/09/api-security-in-the-ai-era)):
- Separare permessi per funzione (training, inference, model management)
- Usare version control per API specs
- Monitorare drift tra comportamento live e spec approvata

### 18. AI Toolkit Integration (Model Playground, Prompt Builder, MCP)
**Problema**: Integrare funzionalità simili all'estensione AI Toolkit di Microsoft.
**Soluzione**: Implementare i seguenti componenti:

**1. Model Playground con parametri configurabili:**
```typescript
interface PlaygroundSettings {
    temperature: number;
    maxTokens: number;
    topP: number;
    frequencyPenalty: number;
    presencePenalty: number;
    stopSequences: string[];
}

// Usare le impostazioni nelle chiamate API
const response = await api.post('/chat/completions', {
    model,
    message,
    temperature: settings.temperature,
    max_tokens: settings.maxTokens,
    top_p: settings.topP
});
```

**2. Prompt Templates con variabili (Agent Builder):**
```typescript
interface PromptTemplate {
    id: string;
    name: string;
    template: string;
    variables: string[];  // Es: ['language', 'code', 'filename']
    category: 'code' | 'debug' | 'refactor' | 'test';
    chainNext?: string;   // Per prompt chaining
}

// Espansione template
let prompt = template.template;
for (const [key, value] of Object.entries(variables)) {
    prompt = prompt.replace(new RegExp(`{{${key}}}`, 'g'), value);
}
```

**3. MCP Server Integration:**
```typescript
interface MCPServer {
    id: string;
    name: string;
    type: 'stdio' | 'http';
    command?: string;
    url?: string;
    tools: MCPTool[];
    status: 'connected' | 'disconnected' | 'error';
}

// Connessione via backend
const response = await api.post('/mcp/connect', {
    server_id: serverId,
    type: server.type,
    command: server.command
});
```

**Fonti:**
- [AI Toolkit for VS Code](https://code.visualstudio.com/docs/intelligentapps/overview)
- [MCP Integration in VS Code](https://code.visualstudio.com/blogs/2025/05/12/agent-mode-meets-mcp)
- [Full MCP Spec Support](https://code.visualstudio.com/blogs/2025/06/12/full-mcp-spec-support)

### 19. RAG con Vector Database per Codebase Search
**Problema**: Accelerare la ricerca nel codice usando embeddings e similarità semantica.
**Soluzione**: Integrare un database vettoriale tramite backend:

```typescript
interface VectorSearchResult {
    id: string;
    content: string;
    metadata: {
        filename: string;
        filepath: string;
        language: string;
        chunk_index: number;
    };
    similarity: number;
}

interface RAGConfig {
    enabled: boolean;
    provider: 'pinecone' | 'qdrant' | 'chroma' | 'weaviate' | 'backend';
    topK: number;
    minSimilarity: number;
}

// Ricerca RAG via backend
const response = await api.post('/rag/search', {
    query,
    top_k: ragConfig.topK,
    min_similarity: ragConfig.minSimilarity,
    include_metadata: true
});

// Aggiungi contesto al prompt
const contextParts = results.map(r =>
    `[${r.metadata.filename}] (${(r.similarity * 100).toFixed(1)}%)\n${r.content}`
);
const ragContext = `Contesto dalla codebase:\n\n${contextParts.join('\n\n---\n\n')}`;
```

**Provider supportati:**
- **Pinecone**: Cloud-hosted, scalabile
- **Qdrant**: Self-hosted o cloud, open source
- **Chroma**: Leggero, ideale per sviluppo locale
- **Weaviate**: Graph-based, supporta multi-tenancy

**Fonti:**
- [Vector Databases for RAG](https://www.pinecone.io/learn/vector-database/)
- [Qdrant Documentation](https://qdrant.tech/documentation/)

### 20. Admin-Controlled AI Toolkit Features
**Problema**: Le funzionalità AI Toolkit devono essere controllate dall'admin.
**Soluzione**: Fetch configurazione da endpoint backend:

```typescript
async function fetchAIToolkitConfig(chatProvider: ChatViewProvider) {
    const response = await api.get('/admin/ai-toolkit/config');

    if (response.data) {
        // Toggle globale
        aiToolkitEnabled = response.data.enabled ?? false;

        // Playground settings (admin-configured)
        playgroundSettings = {
            temperature: response.data.playground?.temperature ?? 0.7,
            maxTokens: response.data.playground?.max_tokens ?? 4096,
            topP: response.data.playground?.top_p ?? 1.0,
            // ...
        };

        // Templates approvati dall'admin
        adminPromptTemplates = response.data.prompt_templates || [];

        // MCP Servers configurati
        mcpServers = response.data.mcp_servers || [];

        // RAG configuration
        ragConfig = response.data.rag || { enabled: false };
    }
}
```

**Backend API Schema:**
```sql
CREATE TABLE ai_toolkit_config (
    id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
    organization_id BIGINT UNSIGNED,
    feature_key VARCHAR(50) NOT NULL,
    enabled BOOLEAN DEFAULT FALSE,
    settings JSON,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY (organization_id, feature_key)
);
```

### 21. Keyboard Shortcuts per AI Toolkit
**Problema**: Accesso rapido alle funzionalità AI Toolkit.
**Soluzione**: Aggiungere keybindings non conflittuali:

```json
"keybindings": [
    {
        "command": "enterprise-ai-chat.useTemplate",
        "key": "ctrl+shift+t",
        "mac": "cmd+shift+t"
    },
    {
        "command": "enterprise-ai-chat.openPlayground",
        "key": "ctrl+shift+p",
        "mac": "cmd+shift+p",
        "when": "focusedView == 'enterprise-ai-chat.chatView'"
    },
    {
        "command": "enterprise-ai-chat.ragSearch",
        "key": "ctrl+shift+r",
        "mac": "cmd+shift+r"
    }
]
```

**Nota**: Evitare conflitti con:
- GitHub Copilot: `Ctrl+Alt+I`, `Ctrl+I`
- VS Code built-in: `Ctrl+P` (Quick Open)

## Comandi Utili

```bash
# Compilare con webpack
npm run webpack

# Creare pacchetto VSIX
npm run package

# Installare estensione
code --install-extension my-extension.vsix

# Disinstallare estensione
code --uninstall-extension publisher.extension-name

# Convertire SVG a PNG
rsvg-convert -w 128 -h 128 icon.svg -o icon.png
```

## Struttura File Consigliata

```
vscode-extension/
├── src/
│   └── extension.ts
├── resources/
│   ├── icon.svg
│   └── icon.png
├── out/
│   └── extension.js (compilato)
├── package.json
├── tsconfig.json
├── webpack.config.js
└── README.md
```

---

## Kanban Integration Best Practices

### 22. Kanban Access Control per Gruppi
**Problema**: Il Kanban deve essere accessibile solo a gruppi specifici di utenti.
**Soluzione**: Aggiungere `kanban_enabled` alla tabella groups e verificare l'accesso:

```sql
-- Aggiungere colonna kanban_enabled
ALTER TABLE `groups` ADD COLUMN kanban_enabled BOOLEAN DEFAULT FALSE;

-- Creare gruppi con permessi Kanban
INSERT INTO `groups` (name, description, kanban_enabled) VALUES
('Developers', 'Development team with Kanban access', TRUE),
('Project Managers', 'PM team with full Kanban access', TRUE),
('QA Team', 'Quality Assurance with limited Kanban', TRUE);
```

**Backend Check (Fastify/Node.js):**
```typescript
async function checkKanbanAccess(userId: number): Promise<boolean> {
    const result = await findOne<{ kanban_enabled: boolean }>(
        db,
        `SELECT MAX(g.kanban_enabled) as kanban_enabled
         FROM user_groups ug
         JOIN \`groups\` g ON ug.group_id = g.id
         WHERE ug.user_id = ? AND g.is_active = TRUE`,
        [userId]
    );

    // Admin sempre ha accesso
    const user = await findOne<{ role: string }>(db, 'SELECT role FROM users WHERE id = ?', [userId]);
    if (user?.role === 'admin') return true;

    return result?.kanban_enabled === true;
}
```

**Extension Check:**
```typescript
// Prima di caricare i progetti Kanban
const accessResponse = await api.get('/api/projects/kanban-access');
if (!accessResponse.data.hasKanbanAccess) {
    panel.postMessage({
        type: 'kanbanAccessDenied',
        payload: { message: 'Your user group does not have Kanban access' }
    });
    return;
}
```

### 23. Feedback Modal (Jira-like) per Task Completion
**Problema**: Quando un task viene completato, serve un feedback strutturato.
**Soluzione**: Mostrare modal con note di completamento prima di spostare nella colonna "Done":

```typescript
// React Component
const [feedbackModal, setFeedbackModal] = useState<{ card: Card; columnName: string } | null>(null);

const handleDrop = (columnId: string, columnName: string) => {
    if (draggedCard && columnName === 'Done') {
        // Mostra modal per feedback
        setFeedbackModal({ card: draggedCard, columnName });
    } else {
        // Sposta direttamente
        onUpdateCard(draggedCard.id, columnId);
    }
};

// Modal JSX
{feedbackModal && (
    <div className="feedback-modal-overlay">
        <div className="feedback-modal">
            <h3>Complete Task</h3>
            <p className="modal-task-title">{feedbackModal.card.title}</p>
            <textarea
                placeholder="Add completion notes, issues resolved, next steps..."
                value={feedbackText}
                onChange={(e) => setFeedbackText(e.target.value)}
            />
            <div className="modal-actions">
                <button onClick={() => setFeedbackModal(null)}>Cancel</button>
                <button onClick={handleComplete} className="complete">
                    Complete Task
                </button>
            </div>
        </div>
    </div>
)}
```

### 24. Kanban con API /tasks invece di /boards
**Problema**: L'admin console usa `/api/projects/{id}/tasks` mentre l'estensione usava `/boards`.
**Soluzione**: Allineare l'API dell'estensione con l'admin console:

```typescript
// Load tasks from the same endpoint as admin console
const tasksResponse = await api.get(`/api/projects/${projectId}/tasks`);
const tasks = tasksResponse.data || [];

// Default columns matching admin console
const DEFAULT_COLUMNS = ['Backlog', 'To Do', 'In Progress', 'Review', 'Done'];

// Group tasks by status into columns
const columns = DEFAULT_COLUMNS.map(columnName => ({
    id: columnName,
    name: columnName,
    color: getColumnColor(columnName),
    cards: tasks
        .filter((t: any) => t.status === columnName)
        .map((t: any) => ({
            id: t.id,
            title: t.title,
            description: t.description,
            priority: t.priority || 'medium',
            column_id: columnName,
            assignee_name: t.assigned_name,
            due_date: t.due_date,
            tags: t.tags || [],
            status: t.status
        }))
}));
```

---

## Modern AI Chat Interface Best Practices (2025)

### 25. Agent Mode Pattern (GitHub Copilot / Cursor Style)
**Problema**: Implementare un agent mode che può eseguire task complessi autonomamente.
**Soluzione**: Basato sui pattern di [GitHub Copilot](https://github.com/microsoft/vscode-copilot-chat) e [Cursor](https://cursor.com/features):

```typescript
interface AgentTask {
    id: string;
    description: string;
    status: 'planning' | 'executing' | 'reviewing' | 'completed' | 'failed';
    subtasks: AgentSubtask[];
    filesModified: string[];
    terminalCommands: string[];
}

interface AgentMode {
    enabled: boolean;
    currentTask: AgentTask | null;
    allowTerminalCommands: boolean;
    allowFileEdits: boolean;
    requireApproval: boolean;
}

// Agent può identificare subtask e eseguirli
async function executeAgentTask(task: string): Promise<AgentTask> {
    // 1. Planning phase
    const plan = await api.post('/agent/plan', { task });

    // 2. Execute subtasks with progress updates
    for (const subtask of plan.subtasks) {
        panel.postMessage({
            type: 'agentProgress',
            payload: { currentSubtask: subtask, progress: subtask.index / plan.subtasks.length }
        });

        await executeSubtask(subtask);
    }

    return task;
}
```

**Fonti:**
- [GitHub Copilot Agent Mode](https://devops.com/github-copilot-evolves-agent-mode-and-multi-model-support-transform-devops-workflows-2/)
- [Cursor Agent Overview](https://cursor.com/docs/agent/overview)

### 26. Inline Chat e Edit Pattern (Cursor Ctrl+K Style)
**Problema**: Permettere edit inline direttamente nel codice senza aprire il pannello chat.
**Soluzione**: Implementare inline editing con diff preview:

```typescript
// Registrare comando per inline edit
vscode.commands.registerCommand('enterprise-ai-chat.inlineEdit', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const selection = editor.selection;
    const selectedText = editor.document.getText(selection);

    // Mostra input box inline
    const instruction = await vscode.window.showInputBox({
        placeHolder: 'Describe the change...',
        prompt: 'What do you want to change in the selected code?'
    });

    if (instruction) {
        // Genera modifica con AI
        const response = await api.post('/chat/edit', {
            code: selectedText,
            instruction,
            language: editor.document.languageId
        });

        // Mostra diff preview
        const diff = await showDiffPreview(selectedText, response.data.newCode);
        if (diff.accepted) {
            await editor.edit(editBuilder => {
                editBuilder.replace(selection, response.data.newCode);
            });
        }
    }
});
```

**Keyboard Shortcut:**
```json
{
    "command": "enterprise-ai-chat.inlineEdit",
    "key": "ctrl+k",
    "mac": "cmd+k",
    "when": "editorTextFocus && editorHasSelection"
}
```

### 27. Multi-Model Support con Model Picker
**Problema**: Permettere all'utente di scegliere tra diversi modelli AI (GPT-4o, Claude, Gemini).
**Soluzione**: Implementare model picker come GitHub Copilot:

```typescript
interface ModelOption {
    id: string;
    displayName: string;
    provider: 'openai' | 'anthropic' | 'google' | 'ollama';
    capabilities: ('chat' | 'vision' | 'code' | 'agent')[];
    contextWindow: number;
    isDefault?: boolean;
}

// Nel pannello chat, mostrare model picker
<select
    value={selectedModel}
    onChange={(e) => setSelectedModel(e.target.value)}
    className="model-picker"
>
    {models.map(model => (
        <option key={model.id} value={model.id}>
            {model.displayName} ({model.provider})
        </option>
    ))}
</select>
```

**Fonti:**
- [Claude Opus 4.5 in GitHub Copilot](https://visualstudiomagazine.com/articles/2025/12/04/claude-opus-4-5-lands-in-github-copilot-for-visual-studio-and-vs-code.aspx)

### 28. Context Tagging (@workspace, @file, @symbol)
**Problema**: Permettere all'utente di specificare il contesto in modo preciso.
**Soluzione**: Implementare sistema di tagging simile a Copilot/Cursor:

```typescript
interface ContextTag {
    type: '@workspace' | '@file' | '@symbol' | '@terminal' | '@selection';
    value?: string;  // Es: filename per @file
}

// Parse dei tag nel messaggio
function parseContextTags(message: string): { tags: ContextTag[]; cleanMessage: string } {
    const tagRegex = /@(workspace|file|symbol|terminal|selection)(?::([^\s]+))?/g;
    const tags: ContextTag[] = [];
    let match;

    while ((match = tagRegex.exec(message)) !== null) {
        tags.push({
            type: `@${match[1]}` as ContextTag['type'],
            value: match[2]
        });
    }

    const cleanMessage = message.replace(tagRegex, '').trim();
    return { tags, cleanMessage };
}

// Gather context based on tags
async function gatherContext(tags: ContextTag[]): Promise<string> {
    let context = '';

    for (const tag of tags) {
        switch (tag.type) {
            case '@workspace':
                context += await getWorkspaceContext();
                break;
            case '@file':
                context += await getFileContent(tag.value);
                break;
            case '@selection':
                context += getEditorSelection();
                break;
        }
    }

    return context;
}
```

### 29. Streaming Response con Markdown Rendering
**Problema**: Mostrare risposte in streaming con rendering markdown in tempo reale.
**Soluzione**: Usare SSE (Server-Sent Events) e markdown parser:

```typescript
// Extension side - SSE streaming
const eventSource = new EventSource(`${serverUrl}/api/chat/stream?token=${token}`);

eventSource.onmessage = (event) => {
    const data = JSON.parse(event.data);

    if (data.type === 'token') {
        // Accumula token
        streamingRef.current += data.content;

        // Aggiorna messaggio con rendering incrementale
        setMessages(prev => {
            const updated = [...prev];
            const lastMsg = updated[updated.length - 1];
            if (lastMsg.role === 'assistant') {
                lastMsg.content = streamingRef.current;
            }
            return updated;
        });
    } else if (data.type === 'done') {
        eventSource.close();
    }
};

// React - Markdown rendering
import ReactMarkdown from 'react-markdown';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';

<ReactMarkdown
    components={{
        code({ node, inline, className, children, ...props }) {
            const match = /language-(\w+)/.exec(className || '');
            return !inline && match ? (
                <SyntaxHighlighter language={match[1]} {...props}>
                    {String(children).replace(/\n$/, '')}
                </SyntaxHighlighter>
            ) : (
                <code className={className} {...props}>{children}</code>
            );
        }
    }}
>
    {message.content}
</ReactMarkdown>
```

### 30. Custom Instructions (.github/copilot-instructions.md Pattern)
**Problema**: Permettere istruzioni personalizzate per progetto.
**Soluzione**: Cercare file di istruzioni nel workspace:

```typescript
async function loadCustomInstructions(): Promise<string | null> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) return null;

    const instructionPaths = [
        '.github/copilot-instructions.md',
        '.enterprise-ai/instructions.md',
        'STYLE.md',
        '.cursorrules'
    ];

    for (const folder of workspaceFolders) {
        for (const instructionPath of instructionPaths) {
            const fullPath = vscode.Uri.joinPath(folder.uri, instructionPath);
            try {
                const content = await vscode.workspace.fs.readFile(fullPath);
                return new TextDecoder().decode(content);
            } catch {
                continue;
            }
        }
    }

    return null;
}

// Aggiungi al system prompt
const customInstructions = await loadCustomInstructions();
if (customInstructions) {
    systemPrompt += `\n\nProject-specific instructions:\n${customInstructions}`;
}
```

**Fonti:**
- [GitHub Copilot Custom Instructions](https://code.visualstudio.com/blogs/2024/12/18/free-github-copilot)
- [Cursor Rules](https://medium.com/@hilalkara.dev/cursor-ai-complete-guide-2025-real-experiences-pro-tips-mcps-rules-context-engineering-6de1a776a8af)

### 31. Plan Mode con Mermaid Diagrams (Cursor 2.0 Style)
**Problema**: Visualizzare piani di implementazione con diagrammi.
**Soluzione**: Generare e visualizzare diagrammi Mermaid nel chat:

```typescript
interface AgentPlan {
    title: string;
    description: string;
    steps: PlanStep[];
    mermaidDiagram?: string;  // Generato dall'AI
}

// Nel prompt, chiedere diagramma Mermaid
const planPrompt = `Create an implementation plan for: ${task}

Include a Mermaid flowchart showing the steps:
\`\`\`mermaid
flowchart TD
    A[Start] --> B[Step 1]
    B --> C[Step 2]
    ...
\`\`\``;

// Render nel chat con mermaid library
import mermaid from 'mermaid';

useEffect(() => {
    mermaid.initialize({ startOnLoad: true, theme: 'dark' });
    mermaid.contentLoaded();
}, [messages]);
```

**Fonti:**
- [Cursor Plan Mode with Mermaid](https://cursor.com/changelog)

---

## Riferimenti Esterni

- **GitHub Copilot Chat Open Source**: https://github.com/microsoft/vscode-copilot-chat
- **Cursor AI Features**: https://cursor.com/features
- **VS Code AI Editor Milestone**: https://code.visualstudio.com/blogs/2025/11/04/openSourceAIEditorSecondMilestone
- **MCP Integration in VS Code**: https://code.visualstudio.com/blogs/2025/05/12/agent-mode-meets-mcp
- **Continue Extension (Open Source Alternative)**: https://continue.dev/
