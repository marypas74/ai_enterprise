# Enterprise AI Chat - VS Code Extension

Estensione VS Code per integrare la piattaforma Enterprise AI Chat nel tuo ambiente di sviluppo.

## Funzionalità

- **Chat AI integrata**: Conversa con modelli AI direttamente da VS Code
- **Selezione modelli**: Scegli tra i modelli configurati dall'amministratore (GPT-4, Claude, Gemini, Llama, ecc.)
- **Contesto codice**: Aggiungi file e selezioni di codice al contesto della conversazione
- **Azioni codice**: Spiega, migliora, correggi codice o genera test con un click
- **Esecuzione comandi**: Esegui comandi bash suggeriti dall'AI con conferma
- **Gestione progetti**: Integrazione con kanban per tracciare il progresso
- **Monitoraggio admin**: Tutte le attività sono tracciate per la console admin

## Requisiti

- VS Code 1.85.0 o superiore
- Accesso al server Enterprise AI Chat
- Credenziali utente valide

## Installazione

1. Scarica il file `.vsix` dell'estensione
2. In VS Code: `Ctrl+Shift+P` → "Extensions: Install from VSIX..."
3. Seleziona il file scaricato
4. Riavvia VS Code

## Utilizzo

1. Clicca sull'icona Enterprise AI Chat nella barra laterale
2. Effettua il login con le tue credenziali
3. Seleziona il modello AI dal menu a tendina
4. Inizia a chattare!

### Comandi disponibili

| Comando | Scorciatoia | Descrizione |
|---------|-------------|-------------|
| Open Chat | `Ctrl+Shift+L` | Apri il pannello chat |
| Add to Chat | `Ctrl+Shift+A` | Aggiungi selezione alla chat |
| Explain Code | - | Spiega il codice selezionato |
| Fix Code | - | Correggi errori nel codice |
| Improve Code | - | Migliora il codice selezionato |
| Generate Tests | - | Genera test per il codice |

### Menu contestuale

Seleziona del codice e fai click destro per accedere al menu "Claude AI" con tutte le azioni disponibili.

## Configurazione

Vai in `File` → `Preferences` → `Settings` e cerca "Enterprise AI Chat":

- **Server URL**: URL del server backend (default: https://192.168.1.123)
- **Use Direct Claude**: Usa Claude direttamente invece del server backend
- **Claude API Key**: API key per uso diretto di Claude

## Sicurezza

- Tutte le comunicazioni sono criptate via HTTPS
- I token di autenticazione sono salvati in modo sicuro
- Le attività sono monitorate per conformità aziendale

## Supporto

Per problemi o suggerimenti, contatta l'amministratore di sistema.

---

**Versione**: 2.2.5
**Publisher**: enterprise-ai
