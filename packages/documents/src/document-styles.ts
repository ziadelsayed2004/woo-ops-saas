/** Print-first layouts. All assets are embedded; no remote styles or scripts. */
export const documentStyles = `
@page { margin: 12mm; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: white; color: #241d30; }
body { font-family: Invoice, Arial, sans-serif; font-size: 10px; line-height: 1.7; }
.page { width: 100%; }
.brand { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #7838a5; padding-bottom: 6mm; margin-bottom: 5mm; }
.brand-logo { width: 48mm; height: 20mm; object-fit: contain; }
.brand p { margin: 1mm 0; font-size: 9px; color: #655b70; }
.doc-title { text-align: end; }
.doc-title h2 { font-size: 22px; margin: 0 0 1mm; }
.pill { font-size: 17px; font-weight: 700; color: #7838a5; direction: ltr; display: inline-block; }
.facts { display: grid; grid-template-columns: 1fr 1fr; gap: 0 7mm; padding: 3mm 4mm; background: #f7f4fa; border-inline-start: 3px solid #7838a5; margin-bottom: 5mm; }
.fact { padding: 1.3mm 0; overflow-wrap: anywhere; }
.fact span { display: block; color: #71647d; font-size: 9px; }
.fact strong { font-size: 11px; font-weight: 600; }
.section-title { font-size: 12px; margin: 0 0 2mm; }
.items { border-collapse: collapse; width: 100%; table-layout: fixed; }
.items thead { display: table-header-group; }
.items th { background: #7838a5; color: white; padding: 2.5mm 1.5mm; font-weight: 700; }
.items td { padding: 3mm 1.5mm; border-bottom: 1px solid #e5ddea; text-align: center; vertical-align: top; overflow-wrap: anywhere; }
.items tr { break-inside: avoid; }
.items tbody tr:nth-child(even) { background: #faf8fc; }
.items th:first-child, .items .index { width: 6%; }
.items th:nth-child(2), .items .product { width: 46%; text-align: start; }
.items th:nth-child(3) { width: 10%; }
.items th:nth-child(4), .items th:nth-child(5) { width: 19%; }
.product strong { font-weight: 500; }
.summary { width: 80mm; margin: 5mm 0 5mm auto; break-inside: avoid; }
[dir=rtl] .summary { margin-left: 0; margin-right: auto; }
.total-row { display: flex; justify-content: space-between; gap: 4mm; padding: 1mm 2mm; }
.total-row strong { white-space: nowrap; direction: ltr; }
.total-row.grand { border-top: 2px solid #7838a5; background: #f3edf8; font-size: 13px; padding: 2.5mm 2mm; margin-top: 2mm; color: #59217e; }
.codes { display: flex; justify-content: space-between; align-items: center; border-top: 1px solid #e5ddea; padding-top: 4mm; break-inside: avoid; }
.barcode { display: block; width: 58mm; height: 13mm; object-fit: contain; }
.qr { width: 20mm; height: 20mm; display: block; margin: auto; }
.code-caption { text-align: center; font: 9px Arial, sans-serif; margin-top: 1mm; direction: ltr; }
.support { display: flex; justify-content: center; gap: 6mm; font-size: 10px; margin-top: 3mm; }
.support span { direction: ltr; }
.footer { text-align: center; font-size: 9px; margin-top: 2mm; white-space: pre-line; overflow-wrap: anywhere; }
.thermal_80mm, .label_100x150mm { color: #000; font-size: 11px; line-height: 1.65; }
.roll .page { width: 80mm; padding: 4mm; }
.roll .brand { display: block; text-align: center; border-color: #000; margin-bottom: 2mm; padding-bottom: 2mm; }
.roll .brand-logo { width: 40mm; height: 16mm; filter: brightness(0); }
.roll .brand p { color: #000; font-size: 9px; }
.roll .doc-title { text-align: center; }
.roll .doc-title h2 { font-size: 16px; margin: 1mm 0 0; }
.roll .pill { color: #000; font-size: 18px; }
.roll .facts { display: block; background: none; border: 0; padding: 0; margin-bottom: 3mm; }
.roll .fact { border-bottom: 1px dashed #888; padding: 1.5mm 0; }
.roll .fact span { color: #000; display: inline; font-size: 10px; }
.roll .fact span::after { content: ': '; }
.roll .fact strong { font-size: 11px; font-weight: 700; }
.roll .items th { background: white; color: black; border-block: 1.5px solid black; padding: 2mm 1mm; }
.roll .items td { padding: 2mm 1mm; border-color: #aaa; font-size: 10px; }
.roll .items tbody tr { background: white; }
.roll .items th:nth-child(1), .roll .items td:nth-child(1), .roll .items th:nth-child(4), .roll .items td:nth-child(4) { display: none; }
.roll .items th:nth-child(2), .roll .items .product { width: 56%; }
.roll .items th:nth-child(3) { width: 12%; }
.roll .items th:nth-child(5) { width: 32%; }
.roll .summary { width: 100%; margin: 3mm 0; }
.roll .total-row { font-size: 10px; }
.roll .total-row.grand { background: white; color: black; border-block: 2px solid black; font-size: 13px; }
.roll .codes { border-color: #000; gap: 2mm; padding-top: 3mm; }
.roll .barcode { width: 46mm; height: 13mm; }
.roll .qr { width: 19mm; height: 19mm; }
.roll .code-caption { font-size: 8px; }
.roll .codes > div:last-child .code-caption { display: none; }
.roll .support { display: block; text-align: center; font-size: 10px; margin-top: 2mm; }
.roll .support span { display: block; }
.roll .footer { font-size: 9px; }
.label_100x150mm .fact:first-child strong { display: block; font-size: 15px; }
`;
