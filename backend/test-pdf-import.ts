import { PDFParse } from 'pdf-parse';

async function test() {
    console.log('Testing PDFParse class...');
    try {
        const dummyBuffer = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >>\nendobj\n4 0 obj\n<< /Length 44 >>\nstream\nBT /F1 12 Tf 100 700 Td (Hello World) Tj ET\nendstream\nendobj\nxref\n0 5\n0000000000 65535 f\n0000000009 00000 n\n0000000062 00000 n\n0000000124 00000 n\n0000000213 00000 n\ntrailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n308\n%%EOF');

        const pdfParse = new PDFParse({ data: dummyBuffer });
        console.log('PDFParse instance created');

        const textResult = await pdfParse.getText();
        console.log('Text extracted:', textResult.text);

        if (textResult.text.includes('Hello World')) {
            console.log('SUCCESS: Text correctly extracted');
        } else {
            console.log('FAILURE: Text mismatch or empty');
        }

        await pdfParse.destroy();
    } catch (err: any) {
        console.error('Error:', err.message);
        console.error(err.stack);
    }
}

test();
