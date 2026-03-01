/**
 * TermsOfServicePage — GAP-3: Terms of Service (AI Act)
 *
 * Pagina pubblica con i termini di servizio, incluse le condizioni
 * di utilizzo dei sistemi di intelligenza artificiale.
 */

import { Link } from 'react-router-dom';
import { ChevronLeft, FileText } from 'lucide-react';

export default function TermsOfServicePage() {
  return (
    <div className="min-h-screen bg-surface-50 dark:bg-surface-950 p-6">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center gap-4 mb-8">
          <Link to="/login" className="p-2 hover:bg-surface-200 dark:hover:bg-surface-800 rounded-full transition-colors">
            <ChevronLeft className="w-6 h-6" />
          </Link>
          <div className="flex items-center gap-3">
            <FileText className="w-8 h-8 text-primary-600" />
            <h1 className="text-3xl font-bold">Termini di Servizio</h1>
          </div>
        </div>

        <div className="card p-8 prose dark:prose-invert max-w-none">
          <p className="text-sm text-surface-500">Ultimo aggiornamento: Febbraio 2026</p>

          <h2>1. Oggetto del Servizio</h2>
          <p>
            Enterprise AI Chat è una piattaforma di chat che utilizza modelli di intelligenza
            artificiale (AI) forniti da provider terzi per generare risposte alle domande degli
            utenti. Il servizio è destinato esclusivamente ad uso aziendale interno.
          </p>

          <h2>2. Accettazione dei Termini</h2>
          <p>
            L'utilizzo del servizio implica l'accettazione integrale dei presenti termini.
            L'utente deve inoltre fornire esplicito consenso all'interazione con sistemi AI
            e al trattamento dei dati personali prima di poter utilizzare il servizio.
          </p>

          <h2>3. Utilizzo dell'Intelligenza Artificiale</h2>
          <p>
            Ai sensi del Regolamento UE 2024/1689 (AI Act), l'utente è informato che:
          </p>
          <ul>
            <li>Le risposte sono generate da modelli AI e <strong>non</strong> da persone</li>
            <li>Le risposte possono contenere errori, imprecisioni o informazioni obsolete</li>
            <li>Le risposte non costituiscono consulenza professionale (medica, legale, finanziaria)</li>
            <li>L'utente è responsabile della verifica delle informazioni ricevute</li>
            <li>I contenuti generati dall'AI sono chiaramente contrassegnati</li>
          </ul>

          <h2>4. Obblighi dell'Utente</h2>
          <ul>
            <li>Utilizzare il servizio in conformità con le leggi applicabili</li>
            <li>Non inserire dati personali di terzi senza il loro consenso</li>
            <li>Non utilizzare il servizio per generare contenuti illeciti, discriminatori o dannosi</li>
            <li>Proteggere le credenziali di accesso e segnalare immediatamente accessi non autorizzati</li>
            <li>Verificare le risposte AI prima di basare decisioni importanti su di esse</li>
          </ul>

          <h2>5. Proprietà Intellettuale</h2>
          <p>
            I contenuti generati dall'AI tramite la piattaforma sono soggetti alle condizioni
            di licenza dei rispettivi provider AI. L'utente è autorizzato a utilizzare tali
            contenuti nell'ambito delle proprie attività aziendali.
          </p>

          <h2>6. Limitazione di Responsabilità</h2>
          <p>
            Il Titolare non è responsabile per:
          </p>
          <ul>
            <li>Errori, omissioni o imprecisioni nelle risposte generate dall'AI</li>
            <li>Decisioni prese dall'utente sulla base delle risposte AI</li>
            <li>Interruzioni del servizio dovute a manutenzione o cause di forza maggiore</li>
            <li>Azioni dei provider AI terzi</li>
          </ul>

          <h2>7. Trattamento dei Dati</h2>
          <p>
            Il trattamento dei dati personali è descritto nella{' '}
            <Link to="/privacy" className="text-primary-600 hover:underline">Privacy Policy</Link>.
            L'utente ha diritto di esercitare i propri diritti (accesso, rettifica, cancellazione,
            portabilità) dalle impostazioni del proprio profilo.
          </p>

          <h2>8. Modifiche ai Termini</h2>
          <p>
            Il Titolare si riserva il diritto di modificare i presenti termini in qualsiasi momento.
            Le modifiche saranno comunicate tramite la piattaforma e richiederanno nuova accettazione.
          </p>

          <h2>9. Legge Applicabile e Foro Competente</h2>
          <p>
            I presenti termini sono regolati dalla legge italiana. Per qualsiasi controversia
            derivante dall'utilizzo del servizio, il foro competente è quello del domicilio
            del Titolare del trattamento.
          </p>
        </div>
      </div>
    </div>
  );
}
