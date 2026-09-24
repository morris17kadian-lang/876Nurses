const fs = require('fs');
const path = require('path');

const outputPath = path.join(__dirname, '..', 'INVOICE-KADIAN-300K.pdf');

const lines = [
  'INVOICE',
  '',
  'Invoice Number: DEV-2026-001',
  'Date: June 26, 2026',
  'Payment Status: PAID IN FULL',
  '',
  'Billed From',
  'Kadian Morris',
  'Email: morris.kadian@yahoo.com',
  'Phone: 8763970760',
  '',
  'Billed To',
  '876 Nurses Home Care Services',
  'Email: 876nurses@gmail.com',
  'Phone: 8763782038',
  '',
  'Description',
  'Professional software development services for the 876 Nurses mobile',
  'application and supporting backend systems.',
  '',
  'Major features delivered:',
  '- Appointment booking workflows',
  '- Nurse scheduling and shift management',
  '- Invoice and payment handling',
  '- Admin dashboard functionality',
  '- Email notification integration',
  '',
  'Billing',
  'Software development services: 300,000.00 JMD',
  '',
  'Total Amount: 300,000.00 JMD',
  'Amount Paid: 300,000.00 JMD',
  'Balance Due: 0.00 JMD',
  '',
  'Payment received in full on June 26, 2026.'
];

function escapePdf(text) {
  return text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

let content = 'BT\n/F1 18 Tf\n50 780 Td\n';
content += `(${escapePdf(lines[0])}) Tj\n`;
content += '0 -28 Td\n/F1 11 Tf\n';

for (const line of lines.slice(1)) {
  content += `(${escapePdf(line)}) Tj\n0 -16 Td\n`;
}

content += 'ET';

const objects = [
  '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj',
  '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj',
  '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj',
  `4 0 obj\n<< /Length ${Buffer.byteLength(content, 'utf8')} >>\nstream\n${content}\nendstream\nendobj`,
  '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj'
];

let pdf = '%PDF-1.4\n';
const offsets = [0];

for (const object of objects) {
  offsets.push(Buffer.byteLength(pdf, 'utf8'));
  pdf += `${object}\n`;
}

const xrefStart = Buffer.byteLength(pdf, 'utf8');
pdf += `xref\n0 ${objects.length + 1}\n`;
pdf += '0000000000 65535 f \n';

for (let index = 1; index < offsets.length; index += 1) {
  pdf += `${String(offsets[index]).padStart(10, '0')} 00000 n \n`;
}

pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;

fs.writeFileSync(outputPath, pdf, 'binary');