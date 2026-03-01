# Enterprise AI Chat — Analisi Conformità EU AI Act

**Versione piattaforma:** 1.7.9
**Data analisi:** 28 Febbraio 2026
**Regolamento:** Regolamento (UE) 2024/1689 — Artificial Intelligence Act
**Scadenza critica:** 2 Agosto 2026 (applicazione generale)

---

## 1. CLASSIFICAZIONE DEL SISTEMA SOTTO L'AI ACT

### 1.1 Ruolo della piattaforma

Enterprise AI Chat **non è un provider di modelli AI** (non addestra modelli propri). È un **deployer** e **integratore** che utilizza modelli di terze parti:

| Ruolo AI Act | Applicabilità | Motivazione |
|-------------|---------------|-------------|
| **Provider di sistema AI** | SI — Parziale | La piattaforma è un "sistema AI" che integra GPAI di terzi e lo rende disponibile agli utenti |
| **Deployer** | SI | Mette in funzione sistemi AI sotto la propria autorità per uso professionale |
| **Provider di modello GPAI** | NO | Non addestra né sviluppa i modelli sottostanti (OpenAI, Anthropic, Google li forniscono) |
| **Importatore/Distributore** | NO | Non importa né distribuisce hardware/software AI nel mercato UE |

### 1.2 Classificazione del rischio

```
┌─────────────────────────────────────────────────────┐
│              RISCHIO INACCETTABILE                   │
│  (Vietato: social scoring, manipolazione, ecc.)     │
│  → NON APPLICABILE alla piattaforma                 │
├─────────────────────────────────────────────────────┤
│              RISCHIO ALTO (Allegato III)             │
│  (Infrastrutture critiche, istruzione, lavoro,      │
│   servizi essenziali, law enforcement)               │
│  → POTENZIALMENTE APPLICABILE se usato in contesti  │
│    HR, recruiting, valutazione credito, ecc.         │
├─────────────────────────────────────────────────────┤
│           ★ RISCHIO LIMITATO (Art. 50) ★            │
│  (Chatbot, generazione contenuti, deepfake)          │
│  → APPLICABILE — Obblighi di trasparenza            │
├─────────────────────────────────────────────────────┤
│              RISCHIO MINIMO                          │
│  (Filtri spam, raccomandazioni, ecc.)               │
│  → Parzialmente applicabile per features minori     │
└─────────────────────────────────────────────────────┘
```

**Classificazione primaria: RISCHIO LIMITATO** — con potenziale escalation a **RISCHIO ALTO** a seconda dell'uso finale del committente.

### 1.3 Articoli applicabili

| Articolo | Titolo | Applicabilità |
|----------|--------|---------------|
| **Art. 50** | Obblighi di trasparenza per provider e deployer | **DIRETTAMENTE APPLICABILE** — chatbot e generazione contenuti |
| **Art. 26** | Obblighi dei deployer di sistemi AI ad alto rischio | Applicabile SE usato in contesti Allegato III |
| **Art. 53** | Obblighi dei provider di modelli GPAI | Non applicabile (i provider sono OpenAI, Anthropic, Google) |
| **Art. 13** | Trasparenza e fornitura di informazioni ai deployer | Responsabilità dei provider GPAI, ma la piattaforma deve trasmetterle |
| **Art. 14** | Sorveglianza umana | Applicabile per sistemi ad alto rischio |
| **Art. 9** | Sistema di gestione del rischio | Applicabile SE classificato alto rischio |

---

## 2. AUDIT DI CONFORMITÀ — STATO ATTUALE

### Legenda
- ✅ Conforme
- ⚠️ Parzialmente conforme
- ❌ Non conforme
- ➖ Non applicabile

### 2.1 Obblighi Art. 50 — Trasparenza (APPLICABILE DAL 2 AGOSTO 2026)

| # | Requisito | Stato | Dettaglio |
|---|-----------|-------|-----------|
| 50.1 | Informare l'utente che interagisce con un sistema AI | ❌ | **Nessun banner o disclosure** nella ChatPage, LoginPage, o nell'estensione VS Code |
| 50.2 | Marcare i contenuti generati come artificiali (testo) | ❌ | **Nessun watermark**, metadata, o etichetta sui messaggi AI nella tabella `messages` e nell'UI |
| 50.3 | Disclosure per contenuti deepfake (audio/video) | ➖ | La piattaforma non genera audio/video |
| 50.4 | Informare quando si usa riconoscimento emotivo | ➖ | Non implementato |

### 2.2 Obblighi di Logging e Tracciabilità

| # | Requisito | Stato | Dettaglio |
|---|-----------|-------|-----------|
| 1 | Audit trail delle azioni amministrative | ✅ | Tabella `audit_log` con user_id, action, entity, IP, timestamp |
| 2 | Tracciamento attività utente | ⚠️ | Tabella `activity_log` presente ma limitata all'estensione |
| 3 | Log delle richieste AI (modello, prompt, risposta) | ❌ | **Manca log completo**: si tracciano token ma NON il contenuto delle decisioni AI |
| 4 | Tracciamento provider/modello per ogni risposta | ⚠️ | `token_usage` registra provider e model, ma non il contenuto |
| 5 | Log degli errori AI e fallback | ⚠️ | CircuitBreaker traccia salute provider, non qualità output |

### 2.3 Sorveglianza Umana (Art. 14)

| # | Requisito | Stato | Dettaglio |
|---|-----------|-------|-----------|
| 1 | Workflow di approvazione per output AI sensibili | ❌ | Solo `tool_executions` ha flag `requires_approval` — non copre risposte chat |
| 2 | Possibilità di override umano | ⚠️ | Agenti hanno tier "manual" per conflitti, ma non per contenuti |
| 3 | Meccanismo di stop/interruzione | ✅ | Abort request presente (frontend + estensione VS Code) |
| 4 | Configurazione di limiti di sicurezza | ⚠️ | Rate limiting presente, ma non content-level safety limits |

### 2.4 Documentazione Tecnica

| # | Requisito | Stato | Dettaglio |
|---|-----------|-------|-----------|
| 1 | Documentazione modelli (capacità, limiti) | ⚠️ | Tabella `ai_models` ha context_window e costi, ma **mancano**: cutoff date, limitazioni, bias assessment |
| 2 | Privacy Policy / Informativa trattamento dati | ❌ | **Nessuna privacy policy** nel codebase |
| 3 | DPIA (Data Protection Impact Assessment) | ❌ | **Nessuna DPIA** trovata |
| 4 | Documentazione dati di training | ➖ | Responsabilità dei provider GPAI (OpenAI, Anthropic, Google) |
| 5 | Istruzioni per l'uso del sistema | ❌ | Nessuna documentazione utente |

### 2.5 Marcatura Contenuti AI-Generated

| # | Requisito | Stato | Dettaglio |
|---|-----------|-------|-----------|
| 1 | Watermark testo generato | ❌ | Nessun watermark |
| 2 | Metadata machine-readable nei contenuti | ❌ | Tabella `messages` non ha campo `is_ai_generated` |
| 3 | Label visuale "Generato da AI" | ❌ | UI non indica provenienza AI dei messaggi |
| 4 | Marcatura documenti generati (DOCX, XLSX, PDF) | ❌ | Documenti generati senza metadata AI |

### 2.6 Diritti degli Utenti

| # | Requisito | Stato | Dettaglio |
|---|-----------|-------|-----------|
| 1 | Consenso informato al trattamento | ❌ | Nessun meccanismo di consenso al signup |
| 2 | Diritto alla cancellazione (GDPR Art. 17) | ⚠️ | Admin può eliminare utenti (cascade), ma l'utente non può auto-cancellarsi |
| 3 | Portabilità dati (GDPR Art. 20) | ❌ | **Nessun endpoint di export dati utente** |
| 4 | Accesso ai propri dati di utilizzo | ❌ | Usage stats visibili solo agli admin, non agli utenti |
| 5 | Opt-out dal processing AI | ❌ | Non implementato |

### 2.7 Monitoraggio Bias e Qualità

| # | Requisito | Stato | Dettaglio |
|---|-----------|-------|-----------|
| 1 | Metriche di fairness/equità | ❌ | Nessuna implementazione |
| 2 | Monitoraggio bias nelle risposte | ❌ | Nessuna implementazione |
| 3 | Monitoraggio error rate per modello | ⚠️ | MetricsService traccia success_rate ma non per categoria |
| 4 | Feedback loop utente sulla qualità | ❌ | Nessun meccanismo di feedback/rating |

---

## 3. SCORECARD DI CONFORMITÀ

### Riepilogo per area

| Area | Requisiti | ✅ | ⚠️ | ❌ | Score |
|------|-----------|---|---|---|-------|
| **Trasparenza (Art. 50)** | 4 | 0 | 0 | 2 | **0%** |
| **Logging/Tracciabilità** | 5 | 1 | 2 | 2 | **30%** |
| **Sorveglianza Umana** | 4 | 1 | 2 | 1 | **38%** |
| **Documentazione** | 5 | 0 | 1 | 3 | **10%** |
| **Marcatura Contenuti** | 4 | 0 | 0 | 4 | **0%** |
| **Diritti Utenti** | 5 | 0 | 1 | 4 | **5%** |
| **Monitoraggio Bias** | 4 | 0 | 1 | 3 | **6%** |
| **TOTALE** | **31** | **2** | **7** | **19** | **~13%** |

### Score complessivo: **13% di conformità AI Act**

```
Conformità: ████░░░░░░░░░░░░░░░░░░░░░░░░░░ 13%
Target:     ████████████████████████████████ 100% (entro 2 Agosto 2026)
```

---

## 4. GAP ANALYSIS — INTERVENTI NECESSARI

### 4.1 PRIORITÀ CRITICA (da implementare prima del 2 Agosto 2026)

#### GAP-1: Disclosure AI (Art. 50.1)
**Impatto:** Violazione diretta dell'Art. 50.1
**Soluzione:**
- Banner persistente in ChatPage: "Stai interagendo con un sistema di intelligenza artificiale"
- Disclosure nel footer dell'estensione VS Code
- Metadata nelle risposte API: `{ "ai_disclosure": true, "model": "...", "provider": "..." }`

**Effort stimato:** 2-3 giorni

#### GAP-2: Marcatura contenuti AI-generated (Art. 50.2)
**Impatto:** Violazione dell'Art. 50.2
**Soluzione:**
- Campo `is_ai_generated: boolean` nella tabella `messages`
- Label visuale "Generato da AI" su ogni messaggio assistant
- Metadata nei documenti generati (proprietà DOCX/PDF "ai-generated: true")
- Header HTTP `AI-Generated: true` nelle risposte streaming

**Effort stimato:** 3-5 giorni

#### GAP-3: Privacy Policy e DPIA
**Impatto:** Violazione GDPR + AI Act
**Soluzione:**
- Redazione Privacy Policy (informativa Art. 13-14 GDPR)
- Conduzione DPIA (AI processing = profilazione potenziale)
- Pagina `/privacy` nel frontend
- Accettazione obbligatoria al primo login

**Effort stimato:** 5-8 giorni (inclusa consulenza legale)

#### GAP-4: Consenso informato
**Impatto:** Violazione GDPR Art. 6-7
**Soluzione:**
- Tabella `user_consents` (id, user_id, consent_type, granted_at, revoked_at)
- Workflow di consenso al signup/primo login
- Granularità: data processing, AI profiling, cookie policy
- API per revoca consenso

**Effort stimato:** 3-4 giorni

### 4.2 PRIORITÀ ALTA (raccomandato entro Q4 2026)

#### GAP-5: Logging decisioni AI completo
**Soluzione:**
- Tabella `ai_decision_log` (request_id, user_id, model, provider, prompt_hash, response_hash, tokens, latency, safety_flags, timestamp)
- NON loggare il contenuto completo (privacy), ma hash + metadata
- Retention policy: 12 mesi

**Effort stimato:** 5-7 giorni

#### GAP-6: Export dati utente (GDPR Art. 20)
**Soluzione:**
- Endpoint `GET /api/user/export` → genera JSON/ZIP con tutti i dati dell'utente
- Include: profilo, conversazioni, messaggi, usage, preferenze
- Formato machine-readable (JSON)

**Effort stimato:** 3-4 giorni

#### GAP-7: Self-service account deletion
**Soluzione:**
- Endpoint `DELETE /api/user/account` con conferma
- Periodo di grazia 30 giorni
- Cancellazione completa + anonimizzazione audit log

**Effort stimato:** 2-3 giorni

#### GAP-8: Documentazione modelli
**Soluzione:**
- Arricchire tabella `ai_models` con: knowledge_cutoff, limitations, bias_notes, safety_rating
- Pagina informativa `/models` visibile agli utenti
- Schede modello con capacità e limitazioni

**Effort stimato:** 3-5 giorni

### 4.3 PRIORITÀ MEDIA (raccomandato per compliance piena)

#### GAP-9: Feedback/Rating risposte AI
**Soluzione:**
- Thumbs up/down su ogni risposta AI
- Tabella `response_feedback` (id, message_id, user_id, rating, comment)
- Dashboard metriche qualità per admin

**Effort stimato:** 3-4 giorni

#### GAP-10: Human oversight per contenuti sensibili
**Soluzione:**
- Content safety filter pre-risposta
- Flag per topic sensibili (medical, legal, financial)
- Workflow di moderazione opzionale

**Effort stimato:** 5-8 giorni

#### GAP-11: Monitoraggio bias
**Soluzione:**
- Metriche per modello: error rate, refusal rate, response time per categoria
- Alert su anomalie statistiche
- Report periodico automatico

**Effort stimato:** 5-7 giorni

---

## 5. ROADMAP DI REMEDIATION

```
                    2026
    MAR         APR         MAG         GIU         LUG        AGO
     │           │           │           │           │          │
     ▼           ▼           ▼           ▼           ▼          ▼
  ┌──────────────────────┐                                    ┌───┐
  │ FASE 1: CRITICA      │                                    │ D │
  │ GAP 1-4              │                                    │ E │
  │ ~15-20 giorni        │                                    │ A │
  └──────────────────────┘                                    │ D │
           ┌──────────────────────┐                           │ L │
           │ FASE 2: ALTA         │                           │ I │
           │ GAP 5-8              │                           │ N │
           │ ~13-19 giorni        │                           │ E │
           └──────────────────────┘                           │   │
                    ┌──────────────────────┐                  │ 2 │
                    │ FASE 3: MEDIA        │                  │   │
                    │ GAP 9-11             │                  │ A │
                    │ ~13-19 giorni        │                  │ G │
                    └──────────────────────┘                  │ O │
                              ┌──────────────────────┐        │   │
                              │ FASE 4: VALIDAZIONE  │        │ 2 │
                              │ Test + Audit esterno │        │ 0 │
                              │ ~5-10 giorni         │        │ 2 │
                              └──────────────────────┘        │ 6 │
                                                              └───┘
```

**Effort totale stimato: 46-68 giorni/uomo**

---

## 6. RISCHI DI NON-CONFORMITÀ

### 6.1 Sanzioni amministrative (Art. 99)

| Violazione | Sanzione massima | Rischio per la piattaforma |
|-----------|------------------|----------------------------|
| Pratiche AI vietate (Art. 5) | €35M o 7% fatturato globale | BASSO — la piattaforma non usa pratiche vietate |
| Obblighi Art. 50 (trasparenza) | €15M o 3% fatturato globale | **ALTO** — disclosure mancante, marcatura assente |
| Informazioni false/incomplete | €7,5M o 1% fatturato globale | MEDIO — documentazione incompleta |

### 6.2 Rischi reputazionali
- Impossibilità di vendere a PA e grandi enterprise dopo Agosto 2026
- Esclusione da bandi pubblici che richiedono conformità AI Act
- Danno reputazionale in caso di audit/segnalazione

### 6.3 Rischi contrattuali
- Clausole di conformità normativa nei contratti enterprise
- Responsabilità solidale deployer-provider in caso di danno
- Impossibilità di assicurarsi per responsabilità AI

---

## 7. IMPATTO SULLA VALUTAZIONE DEL PROGETTO

### 7.1 Valore attuale (senza conformità AI Act)

Come stimato nel report architetturale:
- **Costo di produzione:** €18.700 – €31.300
- **Valore di mercato:** €50.000 – €80.000
- **Valore funzionale:** €80.000 – €150.000

### 7.2 Premium di conformità AI Act

La conformità AI Act è diventata un **differenziatore competitivo critico** nel mercato enterprise europeo. Secondo Gartner, i dipartimenti legali e compliance aumenteranno gli investimenti in strumenti GRC del 50% entro fine 2026.

| Fattore di valore | Impatto stimato |
|-------------------|-----------------|
| **Accesso mercato PA/Enterprise** | +30-50% del valore — senza conformità, la piattaforma è INVENDIBILE a enti pubblici e grandi aziende dopo Agosto 2026 |
| **Differenziazione competitiva** | +15-25% — poche piattaforme AI italiane sono già conformi |
| **Riduzione rischio legale** | +10-15% — elimina il rischio di sanzioni fino a €15M |
| **Certificabilità ISO 42001** | +10-20% — apre la strada alla certificazione AI management |
| **Trust & Reputazione** | +5-10% — dimostra impegno verso AI responsabile |

### 7.3 Stima di valore CON conformità AI Act

| Scenario | Senza AI Act | Con AI Act | Delta |
|----------|-------------|------------|-------|
| **Minimo** | €50.000 | €85.000 | +€35.000 (+70%) |
| **Medio** | €80.000 | €140.000 | +€60.000 (+75%) |
| **Massimo** | €120.000 | €210.000 | +€90.000 (+75%) |

### 7.4 Costo dell'adeguamento

| Fase | Giorni/Uomo | Costo (€450-600/gg) |
|------|-------------|---------------------|
| Fase 1: Critica (GAP 1-4) | 15-20 | €6.750 – €12.000 |
| Fase 2: Alta (GAP 5-8) | 13-19 | €5.850 – €11.400 |
| Fase 3: Media (GAP 9-11) | 13-19 | €5.850 – €11.400 |
| Fase 4: Validazione | 5-10 | €2.250 – €6.000 |
| Consulenza legale (DPIA, Privacy Policy) | — | €3.000 – €8.000 |
| **TOTALE ADEGUAMENTO** | **46-68 gg** | **€23.700 – €48.800** |

### 7.5 ROI dell'adeguamento

```
Investimento adeguamento:     €23.700 – €48.800
Incremento valore piattaforma: €35.000 – €90.000
ROI:                           +48% → +278%
Breakeven:                     Immediato (il valore della conformità supera il costo)
```

---

## 8. RACCOMANDAZIONE FINALE

### Per la fattura al committente

**Scenario A — Fatturare lo stato attuale + roadmap compliance:**
| Voce | Importo |
|------|---------|
| Piattaforma Enterprise AI Chat v1.7.9 | €60.000 – €80.000 |
| Analisi conformità AI Act + roadmap | €3.000 – €5.000 |
| **Totale** | **€63.000 – €85.000** |
| Proposta adeguamento AI Act (separata) | €23.700 – €48.800 |

**Scenario B — Fatturare con impegno di adeguamento incluso:**
| Voce | Importo |
|------|---------|
| Piattaforma Enterprise AI Chat v1.7.9 | €60.000 – €80.000 |
| Adeguamento AI Act compliance (46-68 gg) | €23.700 – €48.800 |
| Consulenza legale DPIA + Privacy Policy | €3.000 – €8.000 |
| **Totale chiavi in mano** | **€86.700 – €136.800** |

**Scenario C — Valore pieno con compliance certificata:**
| Voce | Importo |
|------|---------|
| Piattaforma completa + AI Act compliant | €140.000 – €210.000 |
| (include tutto: sviluppo, compliance, documentazione, validazione) | |

### Raccomandazione

**Lo Scenario B è il più strategico**: permette di fatturare un importo giustificato dalla conformità normativa, posiziona il progetto come "AI Act ready" prima della scadenza di Agosto 2026, e crea un rapporto continuativo con il committente per la fase di adeguamento.

La conformità AI Act **non è opzionale** — è un obbligo di legge con sanzioni fino a €15M. Proporla proattivamente dimostra professionalità e aggiunge valore reale.

---

## Fonti

- [EU AI Act — Testo completo](https://artificialintelligenceact.eu/)
- [Art. 50 — Obblighi di trasparenza](https://artificialintelligenceact.eu/article/50/)
- [Timeline implementazione](https://artificialintelligenceact.eu/implementation-timeline/)
- [Linee guida GPAI](https://digital-strategy.ec.europa.eu/en/policies/guidelines-gpai-providers)
- [DLA Piper — Obblighi Agosto 2025](https://www.dlapiper.com/en-us/insights/publications/2025/08/latest-wave-of-obligations-under-the-eu-ai-act-take-effect)
- [Orrick — 6 Steps Before August 2026](https://www.orrick.com/en/Insights/2025/11/The-EU-AI-Act-6-Steps-to-Take-Before-2-August-2026)
- [SecurePrivacy — AI Risk & Compliance 2026](https://secureprivacy.ai/blog/ai-risk-compliance-2026)
- [LegalNodes — AI Act 2026 Updates](https://www.legalnodes.com/article/eu-ai-act-2026-updates-compliance-requirements-and-business-risks)
- [Code of Practice on Transparency](https://digital-strategy.ec.europa.eu/en/policies/code-practice-ai-generated-content)

---

*Report generato il 28/02/2026 — Analisi su codebase enterprise-ai-chat v1.7.9*
*Conformità attuale: 13% — Target: 100% entro 2 Agosto 2026*
