import { FastifyInstance } from 'fastify';
import { findOne } from '../../database/index.js';

/**
 * ContentSafetyService — GAP-10: Human Oversight per topic sensibili
 *
 * Controlla se il messaggio utente riguarda topic sensibili (medical, legal,
 * financial, hiring) e genera un disclaimer da appendere alla risposta AI.
 */

interface SafetyCheckResult {
  is_sensitive: boolean;
  topics: string[];
  disclaimer: string | null;
  safety_flags: Record<string, boolean> | null;
}

const TOPIC_KEYWORDS: Record<string, string[]> = {
  medical: [
    'diagnosi', 'sintomo', 'sintomi', 'malattia', 'farmaco', 'farmaci', 'medicina',
    'medico', 'dottore', 'ospedale', 'cura', 'terapia', 'dose', 'dosaggio',
    'diagnosis', 'symptom', 'disease', 'drug', 'medication', 'doctor', 'hospital',
    'treatment', 'therapy', 'dosage', 'prescription', 'health condition',
  ],
  legal: [
    'avvocato', 'legale', 'tribunale', 'causa', 'reato', 'penale', 'civile',
    'contratto', 'clausola', 'normativa', 'legge', 'decreto', 'giurisprudenza',
    'lawyer', 'attorney', 'court', 'lawsuit', 'criminal', 'civil', 'contract',
    'clause', 'regulation', 'statute', 'legal advice', 'litigation',
  ],
  financial: [
    'investimento', 'investire', 'azioni', 'borsa', 'trading', 'criptovaluta',
    'mutuo', 'prestito', 'finanziamento', 'tasse', 'fiscale', 'dichiarazione',
    'investment', 'invest', 'stock', 'trading', 'cryptocurrency', 'mortgage',
    'loan', 'tax', 'fiscal', 'financial advice', 'portfolio',
  ],
  hiring: [
    'assunzione', 'colloquio', 'candidato', 'cv', 'curriculum', 'selezione',
    'licenziamento', 'stipendio', 'contratto di lavoro', 'dimissioni',
    'hiring', 'interview', 'candidate', 'resume', 'recruitment', 'firing',
    'salary', 'employment contract', 'termination', 'job application',
  ],
};

const TOPIC_DISCLAIMERS: Record<string, string> = {
  medical: '[Avviso] Questa risposta riguarda un argomento medico/sanitario. Le informazioni fornite non sostituiscono il parere di un medico qualificato. Consultare sempre un professionista sanitario per decisioni riguardanti la salute.',
  legal: '[Avviso] Questa risposta riguarda un argomento legale. Le informazioni fornite non costituiscono consulenza legale. Consultare un avvocato per assistenza specifica.',
  financial: '[Avviso] Questa risposta riguarda un argomento finanziario. Le informazioni fornite non costituiscono consulenza finanziaria. Consultare un consulente finanziario qualificato prima di prendere decisioni di investimento.',
  hiring: '[Avviso] Questa risposta riguarda un argomento relativo a risorse umane/assunzioni. Le decisioni relative al personale devono essere prese da persone qualificate nel rispetto delle normative vigenti.',
};

export class ContentSafetyService {
  private topicOverrides: string[] | null = null;
  private topicCacheExpiry = 0;
  private static readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

  constructor(private readonly fastify: FastifyInstance) {}

  async checkMessage(message: string): Promise<SafetyCheckResult> {
    // Load configured topics from system_settings
    const topics = await this.getConfiguredTopics();
    const messageLower = message.toLowerCase();

    const detectedTopics: string[] = [];
    for (const topic of topics) {
      const keywords = TOPIC_KEYWORDS[topic];
      if (!keywords) continue;

      const found = keywords.some(keyword => messageLower.includes(keyword));
      if (found) {
        detectedTopics.push(topic);
      }
    }

    if (detectedTopics.length === 0) {
      return { is_sensitive: false, topics: [], disclaimer: null, safety_flags: null };
    }

    const disclaimers = detectedTopics
      .map(t => TOPIC_DISCLAIMERS[t])
      .filter(Boolean)
      .join('\n\n');

    return {
      is_sensitive: true,
      topics: detectedTopics,
      disclaimer: disclaimers,
      safety_flags: Object.fromEntries(detectedTopics.map(t => [`sensitive_${t}`, true])),
    };
  }

  private async getConfiguredTopics(): Promise<string[]> {
    // Return cached topics if still within TTL
    if (this.topicOverrides && Date.now() < this.topicCacheExpiry) {
      return this.topicOverrides;
    }

    try {
      const setting = await findOne<{ setting_value: string }>(
        this.fastify.db,
        `SELECT setting_value FROM system_settings WHERE setting_key = 'human_oversight_topics'`
      );
      if (setting?.setting_value) {
        const parsed = JSON.parse(setting.setting_value);
        if (Array.isArray(parsed) && parsed.every(item => typeof item === 'string')) {
          // Filter to only known topics to prevent injection of arbitrary keys
          const validTopics = Object.keys(TOPIC_KEYWORDS);
          this.topicOverrides = parsed.filter(t => validTopics.includes(t));
          this.topicCacheExpiry = Date.now() + ContentSafetyService.CACHE_TTL_MS;
          return this.topicOverrides;
        }
      }
    } catch {
      // fallback to defaults on parse error
    }
    return ['medical', 'legal', 'financial', 'hiring'];
  }
}
