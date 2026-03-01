/**
 * PrivacyPolicyPage — GAP-3: Privacy Policy (GDPR Art. 13-14 + AI Act Art. 50)
 *
 * Pagina pubblica (no auth) con informativa completa sul trattamento
 * dei dati personali e sull'utilizzo di sistemi AI.
 */

import { Link } from 'react-router-dom';
import { ChevronLeft, Shield } from 'lucide-react';

export default function PrivacyPolicyPage() {
  return (
    <div className="min-h-screen bg-surface-50 dark:bg-surface-950 p-6">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center gap-4 mb-8">
          <Link to="/login" className="p-2 hover:bg-surface-200 dark:hover:bg-surface-800 rounded-full transition-colors">
            <ChevronLeft className="w-6 h-6" />
          </Link>
          <div className="flex items-center gap-3">
            <Shield className="w-8 h-8 text-primary-600" />
            <h1 className="text-3xl font-bold">Privacy Policy</h1>
          </div>
        </div>

        <div className="card p-8 prose dark:prose-invert max-w-none">
          <p className="text-sm text-surface-500">Ultimo aggiornamento: Febbraio 2026</p>

          <h2>1. Titolare del Trattamento</h2>
          <p>
            Il titolare del trattamento dei dati personali è l'organizzazione che gestisce
            la piattaforma Enterprise AI Chat (di seguito "Titolare"). Per contattare il Titolare
            o il Responsabile della Protezione dei Dati (DPO), scrivere a: <strong>privacy@example.com</strong>.
          </p>

          <h2>2. Tipologie di Dati Raccolti</h2>
          <ul>
            <li><strong>Dati di registrazione</strong>: nome, email, password (hash)</li>
            <li><strong>Dati di utilizzo</strong>: messaggi inviati, conversazioni, timestamp, modello AI utilizzato</li>
            <li><strong>Dati tecnici</strong>: indirizzo IP, user agent, log di accesso</li>
            <li><strong>Dati di feedback</strong>: valutazioni delle risposte AI (thumbs up/down)</li>
            <li><strong>Consensi</strong>: registrazione di consensi e relative revoche</li>
          </ul>

          <h2>3. Utilizzo di Sistemi di Intelligenza Artificiale</h2>
          <p>
            Ai sensi dell'Art. 50 del Regolamento UE 2024/1689 (AI Act), informiamo che questa
            piattaforma utilizza sistemi di intelligenza artificiale forniti da provider terzi per
            generare risposte alle domande degli utenti. In particolare:
          </p>
          <ul>
            <li>I modelli AI utilizzati includono: OpenAI GPT-4o, Anthropic Claude, Google Gemini e modelli Ollama locali</li>
            <li>Le risposte AI sono chiaramente contrassegnate con il modello utilizzato</li>
            <li>I contenuti generati dall'AI potrebbero non essere sempre accurati o aggiornati</li>
            <li>I dati degli utenti possono essere trasmessi ai provider AI per l'elaborazione delle richieste</li>
            <li>Per topic sensibili (medico, legale, finanziario, HR) viene mostrato un avviso aggiuntivo</li>
          </ul>

          <h2>4. Base Giuridica del Trattamento</h2>
          <ul>
            <li><strong>Consenso</strong> (Art. 6.1.a GDPR): per l'interazione con sistemi AI e il trattamento dei dati</li>
            <li><strong>Esecuzione contrattuale</strong> (Art. 6.1.b GDPR): per l'erogazione del servizio</li>
            <li><strong>Legittimo interesse</strong> (Art. 6.1.f GDPR): per sicurezza, monitoraggio e miglioramento del servizio</li>
            <li><strong>Obbligo legale</strong> (Art. 6.1.c GDPR): per la conformità AI Act e normative applicabili</li>
          </ul>

          <h2>5. Periodo di Conservazione</h2>
          <p>
            I dati personali sono conservati per il periodo strettamente necessario alle finalità
            del trattamento:
          </p>
          <ul>
            <li>Dati di account: per la durata dell'account + 30 giorni dopo la cancellazione</li>
            <li>Conversazioni: archiviate dopo 24h di inattività, eliminate dopo 60 giorni</li>
            <li>Log delle decisioni AI: conservati per 365 giorni (configurabile dall'amministratore)</li>
            <li>Dati di monitoraggio bias: conservati per 2 anni</li>
          </ul>

          <h2>6. Diritti dell'Interessato</h2>
          <p>Ai sensi degli Art. 15-22 del GDPR, l'utente ha diritto di:</p>
          <ul>
            <li><strong>Accesso</strong> (Art. 15): ottenere copia dei propri dati personali</li>
            <li><strong>Rettifica</strong> (Art. 16): correggere dati inesatti</li>
            <li><strong>Cancellazione</strong> (Art. 17): richiedere la cancellazione dei dati</li>
            <li><strong>Limitazione</strong> (Art. 18): limitare il trattamento</li>
            <li><strong>Portabilità</strong> (Art. 20): ricevere i dati in formato strutturato</li>
            <li><strong>Opposizione</strong> (Art. 21): opporsi al trattamento</li>
            <li><strong>Revoca del consenso</strong> (Art. 7): revocare il consenso in qualsiasi momento</li>
          </ul>
          <p>
            Questi diritti possono essere esercitati dalla sezione <Link to="/settings" className="text-primary-600 hover:underline">Impostazioni</Link> del
            proprio profilo o contattando il DPO all'indirizzo indicato sopra.
          </p>

          <h2>7. Trasferimenti Extra-UE</h2>
          <p>
            L'utilizzo di provider AI terzi (OpenAI, Anthropic, Google) può comportare il
            trasferimento di dati al di fuori dello Spazio Economico Europeo. Tali trasferimenti
            avvengono sulla base di:
          </p>
          <ul>
            <li>Clausole contrattuali standard (SCC) approvate dalla Commissione Europea</li>
            <li>Data Processing Agreement (DPA) con ciascun provider</li>
            <li>Adeguate garanzie tecniche e organizzative</li>
          </ul>

          <h2>8. Sicurezza</h2>
          <p>
            La piattaforma implementa misure tecniche e organizzative adeguate per la protezione
            dei dati, tra cui: crittografia in transito (TLS) e a riposo, autenticazione a due fattori,
            controllo degli accessi basato sui ruoli, logging e monitoraggio continuo.
          </p>

          <h2>9. Reclami</h2>
          <p>
            L'utente ha diritto di proporre reclamo all'Autorità Garante per la Protezione dei
            Dati Personali (www.garanteprivacy.it) qualora ritenga che il trattamento dei propri
            dati personali avvenga in violazione del GDPR.
          </p>
        </div>
      </div>
    </div>
  );
}
