
import { PDFParse } from 'pdf-parse';

try {
    console.log('Testing with OBJECT { data: buffer }...');
    const buffer = Buffer.from('%PDF-1.4\n...');
    try {
        const instance2 = new PDFParse({ data: buffer });
        console.log('Instance created with { data: Buffer }');
        console.log('Instance keys:', Object.keys(instance2));
        if (instance2.getText) {
            console.log('getText method exists');
            // Try calling it
            // await instance2.getText(); // Might fail due to invalid PDF data, but method exists
        }
    } catch (e2) {
        console.log('FAILED with { data: Buffer }:', e2.message);
    }

} catch (e) {
    console.error('Test failed:', e);
}
