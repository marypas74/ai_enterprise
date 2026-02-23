
import * as pdfParse from 'pdf-parse';

console.log('pdfParse namespace:', pdfParse);
console.log('Type of pdfParse:', typeof pdfParse);
console.log('Keys:', Object.keys(pdfParse));

if (pdfParse.default) {
    console.log('pdfParse.default type:', typeof pdfParse.default);
}
