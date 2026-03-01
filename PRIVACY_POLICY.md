# Informativa sulla Privacy — Enterprise AI Chat

**Ultimo aggiornamento**: Febbraio 2026

Informativa resa ai sensi degli Artt. 13-14 del Regolamento (UE) 2016/679 (GDPR) e dell'Art. 50 del Regolamento (UE) 2024/1689 (AI Act).

---

## 1. Titolare del Trattamento

Il Titolare del trattamento dei dati personali è **LushLolli S.r.l.**, con sede legale in Italia, che gestisce la piattaforma Enterprise AI Chat.

**Contatti del Responsabile della Protezione dei Dati (DPO):**
- Email: privacy@lushlolli.com
- PEC: privacy@pec.lushlolli.com

## 2. Tipologie di Dati Raccolti

### 2.1 Dati forniti direttamente dall'utente
- **Dati di registrazione**: nome, indirizzo email, password (conservata in forma di hash crittografico)
- **Dati di interazione**: messaggi inviati al sistema AI, contenuto delle conversazioni
- **Feedback**: valutazioni sulle risposte AI (positivo/negativo), commenti

### 2.2 Dati raccolti automaticamente
- **Dati tecnici**: indirizzo IP, user agent del browser, timestamp di accesso
- **Dati di utilizzo**: modello AI selezionato, token consumati, tempo di risposta
- **Log delle decisioni AI**: hash dei prompt e delle risposte, flag di sicurezza
- **Consensi**: registrazione dell'accettazione e delle eventuali revoche

## 3. Utilizzo di Sistemi di Intelligenza Artificiale

Ai sensi dell'Art. 50 del Regolamento (UE) 2024/1689 (AI Act), informiamo che:

### 3.1 Classificazione del Sistema
La piattaforma Enterprise AI Chat è classificata come sistema AI a **rischio limitato** ai sensi dell'Art. 50 dell'AI Act. L'organizzazione opera in qualità di **deployer** (utilizzatore) di modelli AI forniti da provider terzi.

### 3.2 Modelli AI Utilizzati
La piattaforma integra i seguenti modelli AI di provider terzi:

| Provider | Modelli | Knowledge Cutoff |
|----------|---------|-------------------|
| OpenAI | GPT-4o, GPT-4o-mini | Aprile 2024 |
| Anthropic | Claude 3.5 Sonnet, Claude 3 Opus | Aprile 2025 |
| Google | Gemini 1.5 Pro, Gemini 1.5 Flash | Agosto 2024 |
| Ollama (locale) | Vari modelli open-source | Variabile |

### 3.3 Limitazioni Note
- Le risposte AI possono contenere **errori, imprecisioni o allucinazioni**
- I modelli hanno un **knowledge cutoff** (data limite di addestramento) e non conoscono eventi successivi
- Le risposte **non costituiscono consulenza professionale** (medica, legale, finanziaria)
- Per argomenti sensibili, il sistema mostra automaticamente un avviso che invita a consultare un professionista

### 3.4 Misure di Trasparenza Implementate
- **Disclosure banner**: informazione chiara che l'utente sta interagendo con un sistema AI
- **Etichettatura contenuti**: ogni risposta AI è contrassegnata con il modello utilizzato
- **Header HTTP**: marcatura tecnica dei contenuti generati dall'AI
- **Documenti**: metadati AI inclusi nei documenti generati (DOCX, XLSX, PPTX)

## 4. Finalità e Base Giuridica del Trattamento

| Finalità | Base Giuridica | Riferimento |
|----------|---------------|-------------|
| Erogazione del servizio | Esecuzione contrattuale | Art. 6.1.b GDPR |
| Interazione con sistemi AI | Consenso esplicito | Art. 6.1.a GDPR |
| Trattamento dati personali | Consenso esplicito | Art. 6.1.a GDPR |
| Sicurezza e logging | Legittimo interesse | Art. 6.1.f GDPR |
| Monitoraggio bias AI | Obbligo legale (AI Act) | Art. 6.1.c GDPR |
| Conformità normativa | Obbligo legale | Art. 6.1.c GDPR |

## 5. Periodo di Conservazione

| Categoria | Periodo |
|-----------|---------|
| Dati di account | Durata dell'account + 30 giorni dopo la cancellazione |
| Conversazioni attive | Archiviate dopo 24h di inattività |
| Conversazioni archiviate | Eliminate dopo 60 giorni |
| Log delle decisioni AI | 365 giorni (configurabile) |
| Dati di monitoraggio bias | 2 anni |
| Consensi e audit trail | 5 anni (obbligo legale) |

## 6. Diritti dell'Interessato

Ai sensi degli Artt. 15-22 del GDPR, l'interessato ha diritto di:

1. **Accesso** (Art. 15) — Ottenere conferma e copia dei dati trattati
2. **Rettifica** (Art. 16) — Correggere dati inesatti o incompleti
3. **Cancellazione** (Art. 17) — Richiedere la cancellazione dei dati ("diritto all'oblio")
4. **Limitazione** (Art. 18) — Limitare il trattamento in determinati casi
5. **Portabilità** (Art. 20) — Ricevere i dati in formato strutturato e leggibile
6. **Opposizione** (Art. 21) — Opporsi al trattamento basato su legittimo interesse
7. **Revoca del consenso** (Art. 7.3) — Revocare il consenso in qualsiasi momento

### Come esercitare i diritti
- **Self-service**: dalla sezione "Impostazioni > Privacy & Dati" della piattaforma
  - Export dei dati personali in formato JSON
  - Cancellazione dell'account (con periodo di grazia di 30 giorni)
  - Revoca dei consensi
- **Contatto diretto**: scrivendo al DPO all'indirizzo indicato al punto 1

## 7. Trasferimenti di Dati Extra-UE

L'utilizzo di provider AI terzi (OpenAI, Anthropic, Google) può comportare il trasferimento di dati al di fuori dello Spazio Economico Europeo (SEE).

**Garanzie adottate:**
- Clausole contrattuali standard (SCC) approvate dalla Commissione Europea
- Data Processing Agreement (DPA) con ciascun provider
- Valutazione di impatto sui trasferimenti (TIA) per ciascun provider
- Misure tecniche supplementari (crittografia end-to-end, pseudonimizzazione)

I modelli Ollama vengono eseguiti localmente e non comportano trasferimenti extra-UE.

## 8. Misure di Sicurezza

La piattaforma implementa le seguenti misure tecniche e organizzative:

- **Crittografia**: TLS 1.3 in transito, crittografia a riposo per dati sensibili
- **Autenticazione**: JWT + TOTP (MFA), politica di password robuste
- **Controllo accessi**: RBAC (Role-Based Access Control)
- **Logging e audit**: registrazione completa degli accessi e delle operazioni
- **Monitoraggio**: servizio periodico di monitoraggio bias e anomalie
- **Hash dei contenuti**: i prompt e le risposte AI sono conservati come hash SHA-256, non in chiaro

## 9. Processo Decisionale Automatizzato

La piattaforma **non** effettua profilazione o processi decisionali automatizzati con effetti giuridici o significativi sull'interessato ai sensi dell'Art. 22 GDPR. Le risposte AI sono esclusivamente informative e non determinano decisioni automatiche.

## 10. Reclami

L'interessato ha diritto di proporre reclamo all'Autorità Garante per la Protezione dei Dati Personali:
- **Sito web**: www.garanteprivacy.it
- **Email**: garante@gpdp.it
- **PEC**: protocollo@pec.gpdp.it

## 11. Aggiornamenti

La presente informativa può essere aggiornata periodicamente. Le modifiche sostanziali saranno comunicate tramite la piattaforma e richiederanno, ove necessario, la raccolta di un nuovo consenso.

---

*Documento redatto in conformità al GDPR (Reg. UE 2016/679) e all'AI Act (Reg. UE 2024/1689).*
