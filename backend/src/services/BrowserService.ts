/**
 * BrowserService — Headless Chrome integration via Browserless
 * Provides web browsing capabilities for AI agents and tools
 */

const BROWSERLESS_URL = process.env.BROWSERLESS_URL || 'http://browserless:3100';

interface PageContent {
  url: string;
  title: string;
  text: string;
  html?: string;
  screenshot?: Buffer;
  links: { text: string; href: string }[];
  tables: string[][];
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- reserved for future session tracking
interface BrowserSession {
  id: string;
  createdAt: Date;
}

// Block internal/private network URLs
const BLOCKED_PATTERNS = [
  /^https?:\/\/localhost/i,
  /^https?:\/\/127\./,
  /^https?:\/\/10\./,
  /^https?:\/\/172\.(1[6-9]|2\d|3[01])\./,
  /^https?:\/\/192\.168\./,
  /^https?:\/\/0\.0\.0\.0/,
  /^https?:\/\/\[::1\]/,
];

export class BrowserService {
  private static instance: BrowserService;

  static getInstance(): BrowserService {
    if (!BrowserService.instance) {
      BrowserService.instance = new BrowserService();
    }
    return BrowserService.instance;
  }

  /**
   * Check if Browserless is available
   */
  async isAvailable(): Promise<boolean> {
    try {
      const resp = await fetch(`${BROWSERLESS_URL}/health`, {
        signal: AbortSignal.timeout(3000),
      });
      return resp.ok;
    } catch {
      return false;
    }
  }

  /**
   * Check URL safety (SSRF protection)
   */
  private isUrlAllowed(url: string): boolean {
    return !BLOCKED_PATTERNS.some(pattern => pattern.test(url));
  }

  /**
   * Navigate to URL and extract content
   */
  async navigateTo(url: string): Promise<PageContent> {
    if (!this.isUrlAllowed(url)) {
      throw new Error('URL blocked: internal/private network addresses are not allowed');
    }

    try {
      const response = await fetch(`${BROWSERLESS_URL}/content`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url,
          gotoOptions: { waitUntil: 'networkidle2', timeout: 30000 },
        }),
        signal: AbortSignal.timeout(45000),
      });

      if (!response.ok) {
        throw new Error(`Browserless error: ${response.status}`);
      }

      const html = await response.text();
      return this.parseHtml(url, html);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    } catch (error: any) {
      console.error(`[Browser] Navigation failed for ${url}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Take a screenshot of a URL
   */
  async takeScreenshot(url: string, options?: {
    fullPage?: boolean;
    width?: number;
    height?: number;
  }): Promise<Buffer> {
    if (!this.isUrlAllowed(url)) {
      throw new Error('URL blocked');
    }

    const response = await fetch(`${BROWSERLESS_URL}/screenshot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url,
        gotoOptions: { waitUntil: 'networkidle2', timeout: 30000 },
        options: {
          fullPage: options?.fullPage ?? false,
          type: 'png',
        },
        viewport: {
          width: options?.width || 1280,
          height: options?.height || 720,
        },
      }),
      signal: AbortSignal.timeout(45000),
    });

    if (!response.ok) {
      throw new Error(`Screenshot failed: ${response.status}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  /**
   * Extract structured content from a URL (text + tables + links)
   */
  async extractContent(url: string, selector?: string): Promise<string> {
    const page = await this.navigateTo(url);
    let content = `# ${page.title}\n\n${page.text}`;

    if (page.tables.length > 0) {
      content += '\n\n## Tables\n';
      for (const table of page.tables) {
        content += table.join(' | ') + '\n';
      }
    }

    return content.substring(0, 15000); // Limit to 15K chars
  }

  /**
   * Run JavaScript on a page and return the result
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
  async evaluateScript(url: string, script: string): Promise<any> {
    if (!this.isUrlAllowed(url)) {
      throw new Error('URL blocked');
    }

    // Sanitize script — block dangerous patterns
    const dangerousPatterns = [/require\s*\(/, /import\s+/, /process\./, /child_process/, /fs\./];
    if (dangerousPatterns.some(p => p.test(script))) {
      throw new Error('Script contains blocked patterns');
    }

    const response = await fetch(`${BROWSERLESS_URL}/function`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: `module.exports = async ({ page }) => {
          await page.goto('${url.replace(/'/g, "\\'")}', { waitUntil: 'networkidle2' });
          return await page.evaluate(() => { ${script} });
        }`,
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      throw new Error(`Script evaluation failed: ${response.status}`);
    }

    return response.json();
  }

  /**
   * Parse raw HTML into structured PageContent
   */
  private parseHtml(url: string, html: string): PageContent {
    // Extract title
    const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
    const title = titleMatch?.[1]?.trim() || url;

    // Remove script, style, nav, footer, header tags
    const cleanHtml = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<nav[\s\S]*?<\/nav>/gi, '')
      .replace(/<footer[\s\S]*?<\/footer>/gi, '')
      .replace(/<header[\s\S]*?<\/header>/gi, '')
      .replace(/<aside[\s\S]*?<\/aside>/gi, '');

    // Extract links
    const links: { text: string; href: string }[] = [];
    const linkRegex = /<a[^>]+href=["']([^"']+)["'][^>]*>([^<]*)<\/a>/gi;
    let linkMatch;
    while ((linkMatch = linkRegex.exec(cleanHtml)) !== null) {
      const href = linkMatch[1];
      const text = linkMatch[2].trim();
      if (text && href && !href.startsWith('#') && !href.startsWith('javascript:')) {
        links.push({ text, href });
      }
    }

    // Extract tables
    const tables: string[][] = [];
    const tableRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let tableMatch;
    while ((tableMatch = tableRegex.exec(cleanHtml)) !== null) {
      const cells: string[] = [];
      const cellRegex = /<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi;
      let cellMatch;
      while ((cellMatch = cellRegex.exec(tableMatch[1])) !== null) {
        cells.push(cellMatch[1].replace(/<[^>]+>/g, '').trim());
      }
      if (cells.length > 0) tables.push(cells);
    }

    // Extract text content
    const text = cleanHtml
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\s+/g, ' ')
      .trim();

    return { url, title, text: text.substring(0, 50000), links: links.slice(0, 50), tables: tables.slice(0, 20) };
  }
}
