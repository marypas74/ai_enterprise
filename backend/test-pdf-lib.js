
import fs from 'fs';
import * as pdfUrl from 'pdf-parse';

console.log('Successfully imported pdf-parse');
const pdf = pdfUrl.default || pdfUrl;

try {
    const data = await pdf(buffer);
    console.log(data.text);
} catch (e) {
    console.error(e);
}
