/**
 * WebSearchService - Provides web search capabilities for AI chat
 * Uses DuckDuckGo for free, no-API-key search functionality
 */

// Keywords that indicate the user wants current/live information
const SEARCH_TRIGGER_KEYWORDS = [
  // News/Current events
  'news', 'notizie', 'cronaca', 'oggi', 'today', 'current', 'latest', 'recent',
  'breaking', 'happening', 'ultime', 'attualità', 'aggiornamento',
  // Time-sensitive
  'now', 'adesso', 'ora', 'right now', 'live', 'realtime', 'real-time',
  // Weather
  'weather', 'meteo', 'forecast', 'previsioni', 'temperatura', 'tempo fa', 'che tempo',
  // Prices/Markets
  'price', 'prezzo', 'stock', 'crypto', 'bitcoin', 'euro', 'dollar', 'borsa',
  // Sports
  'score', 'risultato', 'match', 'partita', 'game', 'classifica',
  // Search intent
  'search', 'cerca', 'find', 'trova', 'look up', 'google', 'ricerca',
  // Specialized sources
  'reddit', 'stackoverflow', 'huggingface', 'discord', 'github', 'arxiv'
];

interface SpecializedSource {
  domain: string;
  trigger: string[];
}

const SPECIALIZED_SOURCES: Record<string, SpecializedSource> = {
  reddit: { domain: 'reddit.com', trigger: ['reddit', 'u/', 'r/'] },
  stackoverflow: { domain: 'stackoverflow.com', trigger: ['stackoverflow', 'stack overflow', 'error code'] },
  huggingface: { domain: 'huggingface.co', trigger: ['huggingface', 'hf', 'models', 'datasets'] },
  discord: { domain: 'discord.com', trigger: ['discord', 'server'] },
  github: { domain: 'github.com', trigger: ['github', 'repo', 'repository', 'source code'] },
  arxiv: { domain: 'arxiv.org', trigger: ['arxiv', 'paper', 'research'] }
};

// Patterns that suggest time-sensitive queries
const DATE_PATTERNS = [
  /\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]?\d{0,4}/,  // Date patterns
  /202[4-9]/,  // Years
  /gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre/i,
  /january|february|march|april|may|june|july|august|september|october|november|december/i,
  /lunedì|martedì|mercoledì|giovedì|venerdì|sabato|domenica/i,
  /monday|tuesday|wednesday|thursday|friday|saturday|sunday/i
];

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  source?: string;
}

export interface WebSearchResponse {
  query: string;
  results: SearchResult[];
  searchPerformed: boolean;
  error?: string;
}

/**
 * Detect if a message requires web search
 */
export function shouldPerformWebSearch(message: string): boolean {
  const lowerMessage = message.toLowerCase();

  // Check for trigger keywords
  const hasKeyword = SEARCH_TRIGGER_KEYWORDS.some(keyword =>
    lowerMessage.includes(keyword.toLowerCase())
  );

  // Check for date patterns
  const hasDatePattern = DATE_PATTERNS.some(pattern =>
    pattern.test(message)
  );

  // Check for question patterns about current events
  const questionPatterns = [
    /what('s| is).*happening/i,
    /what('s| is).*news/i,
    /cosa.*succede/i,
    /com'è.*tempo/i,
    /che tempo fa/i,
    /qual è.*prezzo/i,
    /dimmi.*notizie/i,
    /dimmi.*cronaca/i,
    /tell me.*about.*today/i,
    /how('s| is).*weather/i
  ];

  const hasQuestionPattern = questionPatterns.some(pattern =>
    pattern.test(message)
  );

  return hasKeyword || hasDatePattern || hasQuestionPattern;
}

/**
 * Extract search query from user message
 */
export function extractSearchQuery(message: string): string {
  // Clean up the message for search
  let query = message
    .replace(/^(dimmi|tell me|cerca|search|find|trova)\s+/i, '')
    .replace(/^(le |la |il |lo |i |gli |the |a |an )/i, '')
    .trim();

  // Limit query length
  if (query.length > 100) {
    query = query.substring(0, 100);
  }

  // Detect specialized sources
  let siteFilter = '';
  for (const [key, source] of Object.entries(SPECIALIZED_SOURCES)) {
    if (source.trigger.some(trigger => message.toLowerCase().includes(trigger))) {
      siteFilter = ` site:${source.domain}`;
      break;
    }
  }

  return query + siteFilter;
}

/**
 * Perform web search using DuckDuckGo HTML search
 * This scrapes DDG results since there's no official free API
 */
export async function performWebSearch(query: string): Promise<WebSearchResponse> {
  console.log(`[WebSearch] Searching for: ${query}`);

  try {
    // Use DuckDuckGo HTML search (more reliable than API)
    const encodedQuery = encodeURIComponent(query);
    const searchUrl = `https://html.duckduckgo.com/html/?q=${encodedQuery}`;

    const response = await fetch(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9,it;q=0.8'
      }
    });

    if (!response.ok) {
      throw new Error(`Search request failed: ${response.status}`);
    }

    const html = await response.text();
    const results = parseSearchResults(html);

    console.log(`[WebSearch] Found ${results.length} results`);

    return {
      query,
      results,
      searchPerformed: true
    };

  } catch (error: any) {
    console.error(`[WebSearch] Error: ${error.message}`);

    // Fallback: Try Google search scraping
    try {
      return await performGoogleSearch(query);
    } catch (fallbackError: any) {
      return {
        query,
        results: [],
        searchPerformed: false,
        error: error.message
      };
    }
  }
}

/**
 * Parse DuckDuckGo HTML results
 */
function parseSearchResults(html: string): SearchResult[] {
  const results: SearchResult[] = [];

  // Simple regex-based parsing for DDG results
  // Look for result links and snippets
  const resultPattern = /<a[^>]+class="result__a"[^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>[\s\S]*?<a[^>]+class="result__snippet"[^>]*>([^<]*(?:<[^>]+>[^<]*)*)<\/a>/gi;

  let match;
  while ((match = resultPattern.exec(html)) !== null && results.length < 5) {
    const url = decodeURIComponent(match[1].replace(/^\/\/duckduckgo\.com\/l\/\?uddg=/, '').split('&')[0]);
    const title = match[2].trim();
    const snippet = match[3].replace(/<[^>]+>/g, '').trim();

    if (url && title && !url.includes('duckduckgo.com')) {
      results.push({
        title,
        url,
        snippet,
        source: new URL(url).hostname.replace('www.', '')
      });
    }
  }

  // Alternative parsing if the above doesn't work
  if (results.length === 0) {
    const altPattern = /<a[^>]+href="([^"]+)"[^>]*class="[^"]*result[^"]*"[^>]*>([^<]+)<\/a>/gi;
    while ((match = altPattern.exec(html)) !== null && results.length < 5) {
      const url = match[1];
      const title = match[2].trim();
      if (url.startsWith('http') && title && !url.includes('duckduckgo')) {
        results.push({
          title,
          url,
          snippet: '',
          source: new URL(url).hostname.replace('www.', '')
        });
      }
    }
  }

  return results;
}

/**
 * Fallback: Google search (basic scraping)
 */
async function performGoogleSearch(query: string): Promise<WebSearchResponse> {
  console.log(`[WebSearch] Fallback to Google search for: ${query}`);

  const encodedQuery = encodeURIComponent(query);
  const searchUrl = `https://www.google.com/search?q=${encodedQuery}&hl=it`;

  const response = await fetch(searchUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'text/html',
      'Accept-Language': 'it-IT,it;q=0.9,en;q=0.8'
    }
  });

  if (!response.ok) {
    throw new Error(`Google search failed: ${response.status}`);
  }

  const html = await response.text();
  const results: SearchResult[] = [];

  // Basic Google results parsing
  const resultPattern = /<a[^>]+href="\/url\?q=([^&"]+)[^"]*"[^>]*>[\s\S]*?<h3[^>]*>([^<]+)<\/h3>/gi;

  let match;
  while ((match = resultPattern.exec(html)) !== null && results.length < 5) {
    const url = decodeURIComponent(match[1]);
    const title = match[2].trim();

    if (url.startsWith('http') && title) {
      results.push({
        title,
        url,
        snippet: '',
        source: new URL(url).hostname.replace('www.', '')
      });
    }
  }

  return {
    query,
    results,
    searchPerformed: results.length > 0
  };
}

/**
 * Format search results for AI context
 */
export function formatSearchResultsForContext(searchResponse: WebSearchResponse): string {
  if (!searchResponse.searchPerformed || searchResponse.results.length === 0) {
    return '';
  }

  const today = new Date().toLocaleDateString('it-IT', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });

  let context = `\n\n[WEB SEARCH RESULTS - ${today}]\n`;
  context += `Query: "${searchResponse.query}"\n\n`;

  searchResponse.results.forEach((result, index) => {
    context += `${index + 1}. ${result.title}\n`;
    context += `   Source: ${result.source || result.url}\n`;
    if (result.snippet) {
      context += `   ${result.snippet}\n`;
    }
    context += '\n';
  });

  context += `\nUse these search results to provide current, accurate information. Cite sources when referencing specific information.\n`;

  return context;
}

/**
 * Main entry point: check message and perform search if needed
 */
export async function enhanceWithWebSearch(message: string, force?: boolean): Promise<{
  shouldSearch: boolean;
  searchContext: string;
  searchResponse?: WebSearchResponse;
}> {
  // Check if search is needed (auto-detect by keywords, or forced by user toggle)
  const shouldSearch = force || shouldPerformWebSearch(message);

  if (!shouldSearch) {
    return {
      shouldSearch: false,
      searchContext: ''
    };
  }

  // Extract query and perform search
  const query = extractSearchQuery(message);
  const searchResponse = await performWebSearch(query);

  // Format results for AI context
  const searchContext = formatSearchResultsForContext(searchResponse);

  return {
    shouldSearch: true,
    searchContext,
    searchResponse
  };
}

export default {
  shouldPerformWebSearch,
  extractSearchQuery,
  performWebSearch,
  formatSearchResultsForContext,
  enhanceWithWebSearch
};
