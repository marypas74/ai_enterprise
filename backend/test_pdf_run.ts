
import { PDFParse } from 'pdf-parse';

try {
    console.log('Class:', PDFParse);
    console.log('Prototype keys:', Object.getOwnPropertyNames(PDFParse.prototype));

    // Attempt to instantiate with dummy data
    // Assuming constructor takes a buffer or object with data
    try {
        const instance = new PDFParse(Buffer.from('%PDF-1.4\n...'));
        console.log('Instance created with Buffer');
        console.log('Instance keys:', Object.keys(instance));
    } catch (e) {
        console.log('Constructor with Buffer failed:', e.message);
        try {
            // Try { data: buffer } as in the code
            const instance2 = new PDFParse({ data: Buffer.from('%PDF-1.4\n...') });
            console.log('Instance created with { data: Buffer }');
            console.log('Instance keys:', Object.keys(instance2));
            if (instance2.getText) {
                console.log('getText method exists on instance');
            } else {
                console.log('getText method MISSING on instance');
            }
        } catch (e2) {
            console.log('Constructor with object failed:', e2.message);
        }
    }

} catch (e) {
    console.error('Test failed:', e);
}
