
import { PDFParse } from 'pdf-parse';

console.log('PDFParse type:', typeof PDFParse);

try {
    if (typeof PDFParse === 'function') {
        console.log('Attempting to instantiate PDFParse...');
        const instance = new PDFParse({ data: Buffer.from('test') });
        console.log('Instance created:', instance);
    } else {
        console.log('PDFParse is not a constructor/function.');
    }
} catch (e) {
    console.error('Error instantiating PDFParse:', e.message);
}

import defaultPdf from 'pdf-parse';
console.log('Default import type:', typeof defaultPdf);
