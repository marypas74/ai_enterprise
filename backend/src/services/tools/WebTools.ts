/**
 * WebTools - Web search and browsing tool definitions and executors
 * Handles web_search, browse_url, take_screenshot, extract_page_data, analyze_screenshot
 */

import { BrowserService } from '../BrowserService.js';
import path from 'path';
import type { ToolDefinition, ToolContext, ToolResult } from '../ToolService.js';

/**
 * Web search/browsing tool definitions for Anthropic API
 */
export function getWebToolDefinitions(): ToolDefinition[] {
  return [
    {
      name: 'web_search',
      description: 'Search the internet for real-time information (news, weather, latest data). Use this when your internal knowledge is insufficient or you need the most up-to-date information.',
      input_schema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'The search query (e.g., " Firenze weather today", "latest AI news February 2026")'
          }
        },
        required: ['query']
      }
    },
    {
      name: 'browse_url',
       
      description: 'Browse a web page and extract its text content, links, and tables. Use this to read articles, documentation, or any web page content.',
      input_schema: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'The full URL to browse (e.g., "https://example.com/article")'
          }
        },
        required: ['url']
      }
    },
    {
      name: 'take_screenshot',
      description: 'Take a screenshot of a web page. Returns a PNG image. Use this when a visual representation of a page is needed.',
      input_schema: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'The full URL to screenshot'
          },
          full_page: {
            type: 'boolean',
            description: 'Whether to capture the full page (default: false, captures viewport only)'
          }
        },
        required: ['url']
      }
    },
    {
      name: 'extract_page_data',
      description: 'Extract structured data from a web page including text, tables, and links. Returns a clean, formatted version of the page content.',
      input_schema: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'The full URL to extract data from'
          }
        },
        required: ['url']
      }
    },
    {
      name: 'analyze_screenshot',
      description: 'Take a screenshot of a web page and analyze it using a vision AI model (LLaVA). Returns a detailed description of the visual content. Use this when you need to understand visual layout, images, charts, or design elements on a page.',
      input_schema: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'The full URL to screenshot and analyze'
          },
          prompt: {
            type: 'string',
            description: 'Optional custom prompt for the vision model (e.g., "What charts are shown on this page?")'
          }
        },
        required: ['url']
      }
    },
  ];
}

/**
 * Execute a web tool
 */
export async function executeWebTool(
  toolName: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
  toolInput: Record<string, any>,
  _context: ToolContext
): Promise<ToolResult | null> {
  switch (toolName) {
    case 'web_search': {
      const { query } = toolInput;
      if (!query) {
        return { success: false, error: 'Missing required parameter: query' };
      }

      try {
        const { performWebSearch } = await import('../WebSearchService.js');
        const searchResponse = await performWebSearch(query);

        if (!searchResponse.searchPerformed || searchResponse.results.length === 0) {
          return {
            success: true,
            output: {
              query,
              results: [],
              message: "No relevant search results found."
            }
          };
        }

        return {
          success: true,
          output: {
            query,
            results: searchResponse.results,
            message: `Found ${searchResponse.results.length} search results.`
          }
        };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
      } catch (error: any) {
        return { success: false, error: `Web search tool failed: ${error.message}` };
      }
    }

    case 'browse_url': {
      const { url } = toolInput;
      if (!url) {
        return { success: false, error: 'Missing required parameter: url' };
      }

      try {
        const browser = BrowserService.getInstance();
        const available = await browser.isAvailable();
        if (!available) {
          return { success: false, error: 'Browser service is not available' };
        }

        const page = await browser.navigateTo(url);
        return {
          success: true,
          output: {
            url: page.url,
            title: page.title,
            content: page.text.substring(0, 20000),
            links: page.links.slice(0, 20),
            tablesCount: page.tables.length,
          }
        };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
      } catch (error: any) {
        return { success: false, error: `Browse failed: ${error.message}` };
      }
    }

    case 'take_screenshot': {
      const { url, full_page } = toolInput;
      if (!url) {
        return { success: false, error: 'Missing required parameter: url' };
      }

      try {
        const browser = BrowserService.getInstance();
        const available = await browser.isAvailable();
        if (!available) {
          return { success: false, error: 'Browser service is not available' };
        }

        const screenshot = await browser.takeScreenshot(url, { fullPage: full_page || false });

        // Save screenshot to generated folder for download
        const fs = await import('fs');
        const generatedDir = path.join(process.env.STORAGE_ROOT || process.cwd(), 'generated');
        if (!fs.default.existsSync(generatedDir)) {
          fs.default.mkdirSync(generatedDir, { recursive: true });
        }
        const filename = `screenshot_${Date.now()}.png`;
        const filePath = path.join(generatedDir, filename);
        fs.default.writeFileSync(filePath, screenshot);
        const downloadUrl = `/api/tools/download/${filename}`;

        return {
          success: true,
          output: {
            url,
            screenshotSize: screenshot.length,
            downloadUrl,
            filename,
            message: 'Screenshot captured successfully'
          }
        };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
      } catch (error: any) {
        return { success: false, error: `Screenshot failed: ${error.message}` };
      }
    }

    case 'extract_page_data': {
      const { url } = toolInput;
      if (!url) {
        return { success: false, error: 'Missing required parameter: url' };
      }

      try {
        const browser = BrowserService.getInstance();
        const available = await browser.isAvailable();
        if (!available) {
          return { success: false, error: 'Browser service is not available' };
        }

        const content = await browser.extractContent(url);
        return {
          success: true,
          output: {
            url,
            content,
            message: 'Page data extracted successfully'
          }
        };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
      } catch (error: any) {
        return { success: false, error: `Extraction failed: ${error.message}` };
      }
    }

    case 'analyze_screenshot': {
      const { url, prompt } = toolInput;
      if (!url) {
        return { success: false, error: 'Missing required parameter: url' };
      }

      try {
        const { VisionService } = await import('../VisionService.js');
        const vision = VisionService.getInstance();
        const analysis = await vision.analyzeUrl(url, prompt);
        return {
          success: true,
          output: {
            url: analysis.url,
            description: analysis.description,
            model: analysis.model,
            screenshotSize: analysis.screenshotSize,
            message: 'Screenshot analyzed successfully with vision model'
          }
        };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
      } catch (error: any) {
        return { success: false, error: `Vision analysis failed: ${error.message}` };
      }
    }

    default:
      return null;
  }
}
