# Data Protection Impact Assessment (DPIA)
## Enterprise AI Chat — Valutazione di Impatto sulla Protezione dei Dati

**Documento**: DPIA ai sensi dell'Art. 35 GDPR
**Data**: Febbraio 2026
**Versione**: 1.0
**Stato**: Approvato

---

## 1. Descrizione del Trattamento

### 1.1 Natura del Trattamento
Enterprise AI Chat è una piattaforma di chat aziendale che utilizza modelli di intelligenza artificiale (AI) forniti da provider terzi (OpenAI, Anthropic, Google, Ollama) per generare risposte alle domande degli utenti in un contesto aziendale.

### 1.2 Ambito del Trattamento
- **Soggetti interessati**: dipendenti e collaboratori dell'organizzazione
- **Categorie di dati**: dati identificativi, dati di interazione con AI, dati tecnici
- **Volume stimato**: fino a 500 utenti, migliaia di conversazioni giornaliere
- **Area geografica**: UE (con trasferimenti extra-UE per i provider AI cloud)

### 1.3 Contesto del Trattamento
- **Settore**: uso aziendale interno (non rivolto al pubblico)
- **Classificazione AI Act**: Rischio limitato (Art. 50 Reg. UE 2024/1689)
- **Ruolo**: Deployer di sistemi AI di terze parti

### 1.4 Finalità del Trattamento
1. Erogazione del servizio di assistenza AI per produttività aziendale
2. Monitoraggio della qualità e sicurezza delle risposte AI
3. Conformità con AI Act (trasparenza, logging, monitoraggio bias)
4. Analisi statistiche aggregate per miglioramento del servizio

## 2. Necessità e Proporzionalità

### 2.1 Base giuridica
| Trattamento | Base giuridica | Giustificazione |
|-------------|---------------|-----------------|
| Registrazione utente | Contratto di lavoro (Art. 6.1.b) | Necessario per erogare il servizio |
| Interazione con AI | Consenso (Art. 6.1.a) | L'utente sceglie attivamente di utilizzare la chat AI |
| Logging decisioni AI | Obbligo legale (Art. 6.1.c) | Richiesto dall'AI Act per sistemi a rischio limitato |
| Monitoraggio bias | Obbligo legale (Art. 6.1.c) | Richiesto dall'AI Act |
| Dati tecnici (IP, UA) | Legittimo interesse (Art. 6.1.f) | Sicurezza e prevenzione abusi |

### 2.2 Minimizzazione dei dati
- I prompt e le risposte AI sono conservati come **hash SHA-256**, non in chiaro, nei log delle decisioni
- Le conversazioni sono **archiviate dopo 24h** e **eliminate dopo 60 giorni**
- I log delle decisioni AI sono conservati per **365 giorni** (configurabile)
- Il consenso è **granulare** (AI disclosure, data processing, ToS separati)

### 2.3 Qualità dei dati
- I dati dell'account sono verificabili e modificabili dall'utente
- I log sono generati automaticamente e non soggetti a errori manuali

## 3. Valutazione dei Rischi

### 3.1 Rischi per i diritti e le libertà degli interessati

| # | Rischio | Probabilità | Impatto | Livello |
|---|---------|------------|---------|---------|
| R1 | Esposizione di dati personali tramite risposte AI | Bassa | Alto | Medio |
| R2 | Bias nelle risposte AI che causano discriminazione | Media | Medio | Medio |
| R3 | Dipendenza eccessiva da risposte AI per decisioni importanti | Media | Alto | Alto |
| R4 | Trasferimento dati extra-UE a provider AI | Alta | Medio | Alto |
| R5 | Accesso non autorizzato a conversazioni | Bassa | Alto | Medio |
| R6 | Mancata consapevolezza dell'utente sull'uso di AI | Media | Medio | Medio |
| R7 | Profilazione non intenzionale tramite pattern di utilizzo | Bassa | Medio | Basso |
| R8 | Allucinazioni AI con informazioni false su temi sensibili | Alta | Alto | Critico |

### 3.2 Rischi specifici AI Act

| # | Rischio | Art. AI Act | Livello |
|---|---------|-------------|---------|
| A1 | Mancata informazione sull'interazione con AI | Art. 50.1 | Alto |
| A2 | Contenuti AI non marcati adeguatamente | Art. 50.2 | Medio |
| A3 | Assenza di human oversight per topic sensibili | Art. 14 | Alto |
| A4 | Mancato monitoraggio bias | Art. 9 | Medio |

## 4. Misure di Mitigazione

### 4.1 Misure tecniche

| Rischio | Misura | Stato |
|---------|--------|-------|
| R1 | Hash SHA-256 dei contenuti nei log (non in chiaro) | ✅ Implementato |
| R2 | Servizio di monitoraggio bias (BiasMonitorService, 24h) | ✅ Implementato |
| R3 | Disclaimer su topic sensibili (medical, legal, financial, hiring) | ✅ Implementato |
| R4 | DPA con provider, SCC, valutazione TIA | ✅ In essere |
| R5 | JWT + MFA, RBAC, audit logging | ✅ Implementato |
| R6 | Banner disclosure persistente, label su ogni messaggio AI | ✅ Implementato |
| R7 | Nessuna profilazione, dati aggregati per statistiche | ✅ By design |
| R8 | ContentSafetyService con warning per topic sensibili | ✅ Implementato |

### 4.2 Misure organizzative

| Misura | Stato |
|--------|-------|
| Privacy Policy conforme GDPR + AI Act | ✅ Pubblicata |
| Termini di Servizio con sezione AI | ✅ Pubblicati |
| Raccolta consenso esplicito (3 tipi) | ✅ Implementato |
| Portabilità dati (export JSON) | ✅ Implementato |
| Diritto alla cancellazione (grace period 30gg) | ✅ Implementato |
| Dashboard admin per monitoraggio compliance | ✅ Implementato |
| Documentazione modelli AI (limitazioni, bias, cutoff) | ✅ Implementato |
| Feedback utente su risposte AI (thumbs up/down) | ✅ Implementato |

### 4.3 Copertura GAP AI Act

| GAP | Descrizione | Misura implementata | Stato |
|-----|-------------|---------------------|-------|
| GAP-1 | AI Disclosure (Art. 50.1) | Banner, header HTTP, disclosure SSE | ✅ |
| GAP-2 | Content Marking (Art. 50.2) | Label messaggi, metadata documenti | ✅ |
| GAP-3 | Privacy Policy + DPIA | Pagine dedicate, documenti MD | ✅ |
| GAP-4 | Consenso utente | Modal 3 checkbox, tabella consents | ✅ |
| GAP-5 | AI Decision Logging | ai_decision_log con hash | ✅ |
| GAP-6 | Data Export (GDPR Art. 20) | Endpoint + UI export JSON | ✅ |
| GAP-7 | Account Deletion | 2-step con grace period 30gg | ✅ |
| GAP-8 | Model Documentation | Colonne ai_models + pagina transparency | ✅ |
| GAP-9 | Feedback AI | Thumbs up/down + response_feedback | ✅ |
| GAP-10 | Human Oversight | ContentSafetyService + warning UI | ✅ |
| GAP-11 | Bias Monitoring | BiasMonitorService 24h + dashboard | ✅ |

## 5. Conclusioni e Decisione

### 5.1 Rischio residuo
Dopo l'implementazione di tutte le misure di mitigazione, il rischio residuo è valutato come **BASSO-MEDIO**, accettabile per un sistema AI classificato a rischio limitato.

### 5.2 Decisione
Si procede con il trattamento alle condizioni indicate, con le seguenti raccomandazioni:
1. **Revisione periodica** della DPIA ogni 12 mesi o in caso di modifiche significative
2. **Aggiornamento** della documentazione dei modelli AI quando nuovi modelli vengono attivati
3. **Monitoraggio continuo** degli alert del BiasMonitorService
4. **Formazione** degli utenti sull'uso consapevole dell'AI
5. **Aggiornamento DPA** con i provider AI quando cambiano le condizioni

### 5.3 Consultazione preventiva
Non si ritiene necessaria la consultazione preventiva con l'Autorità Garante ai sensi dell'Art. 36 GDPR, in quanto il rischio residuo è stato ridotto a livelli accettabili tramite le misure implementate.

## 6. Registro delle Revisioni

| Data | Versione | Modifiche | Autore |
|------|----------|-----------|--------|
| Feb 2026 | 1.0 | Prima stesura — DPIA completa per AI Act compliance | DPO |

---

*Documento redatto in conformità all'Art. 35 GDPR e alle Linee Guida WP248 rev.01 del WP29 (ora EDPB).*
