
import { PDFParse } from 'pdf-parse';
import fs from 'fs/promises';

const filePath = 'test_cv.pdf';

async function run() {
    try {
        console.log(`Reading file: ${filePath}`);
        const buffer = await fs.readFile(filePath);
        console.log(`File size: ${buffer.length} bytes`);

        console.log('Instantiating PDFParse...');
        const parser = new PDFParse({ data: buffer });

        console.log('Extracting text...');
        const data = await parser.getText();

        console.log('Extraction complete!');
        console.log(`Text length: ${data.text.length}`);
        console.log('Preview:', data.text.substring(0, 100));

    } catch (e) {
        console.error('Processing failed:', e);
    }
}

run();
