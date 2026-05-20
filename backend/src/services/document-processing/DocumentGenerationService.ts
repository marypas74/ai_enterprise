/**
 * Document Generation Service
 * Handles generation of DOCX, Excel, and PowerPoint documents
 */

import ExcelJS from 'exceljs';
import { Document, Packer, Paragraph, TextRun } from 'docx';
import fs from 'fs/promises';
import PptxGenJS from 'pptxgenjs';

/**
 * Generate a DOCX buffer from text
 */
export async function generateDocxBuffer(
    text: string,
    title: string = 'Documento Generato'
): Promise<Buffer> {
    try {
        const paragraphs = text.split('\n').map(line => {
            return new Paragraph({
                children: [
                    new TextRun({
                        text: line,
                        size: 24, // 12pt
                    }),
                ],
            });
        });

        const doc = new Document({
            sections: [{
                properties: {},
                children: [
                    new Paragraph({
                        children: [
                            new TextRun({
                                text: title,
                                bold: true,
                                size: 32, // 16pt
                            }),
                        ],
                    }),
                    new Paragraph({ children: [] }),
                    ...paragraphs,
                ],
            }],
        });

        return await Packer.toBuffer(doc);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    } catch (error: any) {
        console.error(`[DocumentProcessor] DOCX generation error: ${error.message}`);
        throw new Error(`DOCX generation failed: ${error.message}`);
    }
}

/**
 * Generate an Excel buffer from data
 * @param data Array of objects (rows)
 * @param sheetName Name of the sheet
 */
export async function generateExcelBuffer(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    data: Record<string, any>[],
    sheetName: string = 'Sheet1'
): Promise<Buffer> {
    try {
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet(sheetName);

        if (data.length > 0) {
            // Add headers from first object's keys
            const columns = Object.keys(data[0]).map(key => ({ header: key, key }));
            worksheet.columns = columns;
            // Add rows
            for (const row of data) {
                worksheet.addRow(row);
            }
        }

        const arrayBuffer = await workbook.xlsx.writeBuffer();
        return Buffer.from(arrayBuffer);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    } catch (error: any) {
        console.error(`[DocumentProcessor] Excel generation error: ${error.message}`);
        throw new Error(`Excel generation failed: ${error.message}`);
    }
}

/**
 * Generate a professional PowerPoint buffer from slides
 * @param slides Array of { title, content }
 * @param title Presentation title
 */
export async function generatePptxBuffer(
    slides: { title: string; content: string }[],
    title: string = 'Presentazione'
): Promise<Buffer> {
    try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
        const pptx = new (PptxGenJS as any)();

        // Professional color palette
        const COLORS = {
            primary: '1B3A5C',      // Dark blue
            secondary: '2E6BA6',     // Medium blue
            accent: '4A90D9',        // Light blue
            text: '2D2D2D',          // Near-black for body text
            textLight: '5A5A5A',     // Gray for subtitles
            background: 'FFFFFF',    // White
            headerBg: '1B3A5C',     // Header background
            footerText: '8C8C8C',   // Light gray for footer
            bulletColor: '2E6BA6',   // Blue bullets
        };

        // Layout constants (inches) — proper margins for professional look
        const MARGIN = {
            left: 0.8,
            right: 0.8,
            top: 0.6,
            bottom: 0.8,
        };
        const CONTENT_WIDTH = 10 - MARGIN.left - MARGIN.right; // ~8.4"
        const SLIDE_HEIGHT = 5.63; // Standard 16:9 slide height

        // Metadata
        pptx.author = 'Enterprise AI Chat';
        pptx.company = 'Enterprise AI';
        pptx.subject = title;
        pptx.title = title;
        pptx.layout = 'LAYOUT_WIDE'; // 13.33 x 7.5 — standard widescreen

        // --- Title Slide ---
        const titleSlide = pptx.addSlide();
        // Blue accent bar at top
        titleSlide.addShape('rect', {
            x: 0, y: 0, w: '100%', h: 0.15,
            fill: { color: COLORS.primary }
        });
        // Blue accent bar at bottom
        titleSlide.addShape('rect', {
            x: 0, y: 6.9, w: '100%', h: 0.6,
            fill: { color: COLORS.primary }
        });
        // Title
        titleSlide.addText(title, {
            x: MARGIN.left, y: 2.0, w: CONTENT_WIDTH, h: 1.5,
            fontSize: 36, fontFace: 'Calibri', bold: true,
            color: COLORS.primary, align: 'center', valign: 'middle'
        });
        // Decorative line under title
        titleSlide.addShape('rect', {
            x: 3.5, y: 3.6, w: 3.3, h: 0.04,
            fill: { color: COLORS.accent }
        });
        // Subtitle
        titleSlide.addText('Generato da Enterprise AI', {
            x: MARGIN.left, y: 4.0, w: CONTENT_WIDTH, h: 0.6,
            fontSize: 16, fontFace: 'Calibri',
            color: COLORS.textLight, align: 'center'
        });
        // Date in footer bar
        const dateStr = new Date().toLocaleDateString('it-IT', { year: 'numeric', month: 'long', day: 'numeric' });
        titleSlide.addText(dateStr, {
            x: MARGIN.left, y: 7.0, w: CONTENT_WIDTH, h: 0.4,
            fontSize: 11, fontFace: 'Calibri',
            color: 'FFFFFF', align: 'center'
        });

        // --- Content Slides ---
        const totalSlides = slides.length;
        for (let idx = 0; idx < totalSlides; idx++) {
            const slideData = slides[idx];
            const slide = pptx.addSlide();

            // Top colored header bar
            slide.addShape('rect', {
                x: 0, y: 0, w: '100%', h: 1.1,
                fill: { color: COLORS.primary }
            });

            // Slide title (white on blue header)
            slide.addText(slideData.title, {
                x: MARGIN.left, y: 0.15, w: CONTENT_WIDTH - 1, h: 0.8,
                fontSize: 22, fontFace: 'Calibri', bold: true,
                color: 'FFFFFF', valign: 'middle'
            });

            // Parse content into structured bullet items
            const contentItems = parseSlideContent(slideData.content);

            // Content area with proper margins
            const contentY = 1.4;
            const contentH = SLIDE_HEIGHT - contentY - MARGIN.bottom;

            if (contentItems.length > 0) {
                // Build text array for PptxGenJS with proper bullet formatting
                // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
                const textRows: any[] = [];
                for (const item of contentItems) {
                    const indent = item.level * 0.3;
                    const bulletChar = item.level === 0 ? '\u25CF' : item.level === 1 ? '\u25CB' : '\u2013';
                    const fontSize = item.level === 0 ? 14 : 13;

                    textRows.push({
                        text: item.text,
                        options: {
                            fontSize,
                            fontFace: 'Calibri',
                            color: COLORS.text,
                            bullet: { code: bulletChar.charCodeAt(0).toString(16), indent: indent },
                            indentLevel: item.level,
                            paraSpaceAfter: 6,
                            paraSpaceBefore: item.level === 0 ? 4 : 0,
                        }
                    });
                }

                slide.addText(textRows, {
                    x: MARGIN.left, y: contentY, w: CONTENT_WIDTH, h: contentH,
                    valign: 'top', shrinkText: true
                });
            } else {
                // Plain text fallback
                slide.addText(slideData.content, {
                    x: MARGIN.left, y: contentY, w: CONTENT_WIDTH, h: contentH,
                    fontSize: 14, fontFace: 'Calibri', color: COLORS.text,
                    align: 'left', valign: 'top', paraSpaceAfter: 6
                });
            }

            // Thin accent line above footer
            slide.addShape('rect', {
                x: MARGIN.left, y: 6.95, w: CONTENT_WIDTH, h: 0.02,
                fill: { color: COLORS.accent }
            });

            // Footer: slide number
            slide.addText(`${idx + 1} / ${totalSlides}`, {
                x: CONTENT_WIDTH - 0.5, y: 7.05, w: 1.5, h: 0.35,
                fontSize: 10, fontFace: 'Calibri',
                color: COLORS.footerText, align: 'right'
            });

            // Footer: title reference
            slide.addText(title, {
                x: MARGIN.left, y: 7.05, w: 4, h: 0.35,
                fontSize: 10, fontFace: 'Calibri',
                color: COLORS.footerText, align: 'left'
            });
        }

        return (await pptx.write({ outputType: 'nodebuffer' })) as unknown as Buffer;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    } catch (error: any) {
        console.error(`[DocumentProcessor] PPTX generation error: ${error.message}`);
        throw new Error(`PPTX generation failed: ${error.message}`);
    }
}

/**
 * Parse slide content text into structured bullet items with indentation levels
 */
export function parseSlideContent(content: string): { text: string; level: number }[] {
    const lines = content.split('\n').filter(line => line.trim().length > 0);
    if (lines.length <= 1) return [];

    const items: { text: string; level: number }[] = [];
    for (const raw of lines) {
        const line = raw.trimEnd();
        // Detect indentation level from leading whitespace, bullets, or dashes
        const leadingMatch = line.match(/^(\s*)([-\u2022\u25CF\u25CB\u25AA\u25B8\u25BA*]\s*|\d+[.)]\s*)?(.+)/);
        if (!leadingMatch) continue;

        const whitespace = leadingMatch[1] || '';
        const bulletPrefix = leadingMatch[2] || '';
        const text = leadingMatch[3].trim();
        if (!text) continue;

        // Determine indent level: 0=top, 1=sub, 2=sub-sub
        let level = 0;
        const totalIndent = whitespace.length + (bulletPrefix ? 1 : 0);
        if (totalIndent >= 6) level = 2;
        else if (totalIndent >= 2) level = 1;

        items.push({ text, level });
    }
    return items;
}

/**
 * Convert extracted text into a DOCX document
 * Returns the path of the generated DOCX file
 */
export async function convertTextToDocx(
    text: string,
    outputPath: string,
    title: string = 'Documento Convertito'
): Promise<string> {
    try {
        const buffer = await generateDocxBuffer(text, title);
        await fs.writeFile(outputPath, buffer);
        return outputPath;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    } catch (error: any) {
        console.error(`[DocumentProcessor] DOCX conversion error: ${error.message}`);
        throw new Error(`DOCX conversion failed: ${error.message}`);
    }
}

/**
 * Generate an Excel document from data and save it to disk
 */
export async function convertDataToXlsx(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    data: Record<string, any>[],
    outputPath: string,
    sheetName: string = 'Dati'
): Promise<string> {
    try {
        const buffer = await generateExcelBuffer(data, sheetName);
        await fs.writeFile(outputPath, buffer);
        return outputPath;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    } catch (error: any) {
        console.error(`[DocumentProcessor] Excel conversion error: ${error.message}`);
        throw new Error(`Excel conversion failed: ${error.message}`);
    }
}

/**
 * Generate a PowerPoint presentation from slides and save it to disk
 */
export async function convertSlidesToPptx(
    slides: { title: string; content: string }[],
    outputPath: string,
    title: string = 'Presentazione Generata'
): Promise<string> {
    try {
        const buffer = await generatePptxBuffer(slides, title);
        await fs.writeFile(outputPath, buffer);
        return outputPath;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    } catch (error: any) {
        console.error(`[DocumentProcessor] PPTX conversion error: ${error.message}`);
        throw new Error(`PPTX conversion failed: ${error.message}`);
    }
}
