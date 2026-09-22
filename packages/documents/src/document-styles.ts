/** Branded print styles: A4 in store colors, roll media in pure black and white. */
export const documentStyles = `
@page { margin: 13mm 14mm; }
* { box-sizing: border-box; }
html,body { margin:0; padding:0; color:#182940; background:#fff; }
body { font-family:Invoice,Arial,sans-serif; font-size:11px; line-height:1.65; }
bdi { unicode-bidi:isolate; }
h1,h2,h3,p,dl,dd { margin:0; }
.page { width:100%; }
.brand { display:flex; align-items:center; justify-content:space-between; gap:12mm; padding:2mm 0 7mm; border-bottom:3px solid #1e4899; position:relative; }
.brand::after { content:''; width:30mm; height:3px; background:#f8af28; position:absolute; bottom:-3px; inset-inline-end:0; }
.brand-logo { display:block; width:53mm; height:22mm; object-fit:contain; }
.brand-site { font-size:9px; color:#617089; letter-spacing:1px; margin-top:1mm; }
.document-identity { text-align:end; }
.eyebrow { color:#64748b; font-size:9px; letter-spacing:.8px; }
h1 { font-size:27px; color:#1e4899; line-height:1.5; font-weight:700; }
.order-reference { display:flex; align-items:baseline; justify-content:flex-end; gap:3mm; margin-top:1mm; }
.order-reference span { font-size:9px; color:#68788d; }
.order-reference bdi { font-size:17px; font-weight:700; }
.date { font-size:10px; color:#68788d; margin-top:1mm; }
.information { display:grid; grid-template-columns: .9fr 1.1fr; gap:8mm; padding:7mm 0; }
.info-card { border-inline-start:2px solid #e3e9f2; padding-inline-start:4mm; min-width:0; }
.info-card h3,.order-note h3 { color:#1e4899; font-size:10px; font-weight:700; margin-bottom:2mm; }
.customer-name { font-size:16px; font-weight:700; margin-bottom:2mm; line-height:1.6; overflow-wrap:anywhere; }
.detail { display:grid; grid-template-columns:23mm minmax(0,1fr); gap:2mm; margin-bottom:1mm; }
.detail dt { color:#68788d; font-size:9px; }
.detail dd { font-size:11px; overflow-wrap:anywhere; }
.section-heading { display:flex; justify-content:space-between; align-items:center; margin-bottom:3mm; }
h2 { font-size:13px; }
.section-heading span { color:#68788d; font-size:9px; }
.items { width:100%; border-collapse:collapse; table-layout:fixed; }
.items thead { display:table-header-group; }
.items th { padding:3mm 2mm; background:#1e4899; color:white; font-size:10px; text-align:center; }
.items td { padding:3.5mm 2mm; border-bottom:1px solid #e2e8f0; vertical-align:top; text-align:center; font-size:11px; overflow-wrap:anywhere; }
.items tbody tr:nth-child(even) { background:#f6f8fb; }
.items tr { break-inside:avoid; }
.items .index { width:6%; color:#78879b; }
.items th.index { color:white; }
.items .product { width:42%; text-align:start; }
.items .quantity { width:10%; }
.items .amount { width:21%; }
.closing { display:grid; grid-template-columns:1fr 78mm; gap:12mm; padding:6mm 0; break-inside:avoid; }
.order-note { padding-top:2mm; }
.order-note p { color:#67758b; font-size:10px; overflow-wrap:anywhere; white-space:pre-line; }
.total-row { display:flex; align-items:baseline; justify-content:space-between; gap:3mm; padding:1.3mm 2mm; font-size:10px; }
.total-row bdi { white-space:nowrap; }
.grand { border-top:2px solid #f8af28; background:#f1f5fb; padding:3mm; margin-top:2mm; display:flex; justify-content:space-between; align-items:center; gap:2mm; }
.grand span { font-size:11px; font-weight:700; }
.grand bdi { font-size:16px; color:#1e4899; font-weight:700; white-space:nowrap; }
.document-footer { border-top:1px solid #dce4ed; padding-top:5mm; display:flex; justify-content:space-between; align-items:center; gap:5mm; break-inside:avoid; }
.scan { display:flex; align-items:center; gap:3mm; }
.qr { width:22mm; height:22mm; }
.contact { display:flex; flex-direction:column; align-items:flex-start; gap:.3mm; font-size:9px; }
.contact strong { font-size:9px; color:#1e4899; margin-bottom:.5mm; }
.tracking { text-align:center; font-size:10px; }
.barcode { display:block; width:51mm; height:15mm; object-fit:contain; }
.thanks { text-align:center; font-size:9px; color:#64748b; padding-top:4mm; }
.custom-note { font-size:10px; white-space:pre-line; overflow-wrap:anywhere; margin-top:3mm; }
.roll { color:#000; font-size:11px; line-height:1.6; }
.roll .page { width:80mm; padding:4mm; }
.roll .brand { display:block; text-align:center; border-bottom:1.5px solid #000; padding:0 0 3mm; }
.roll .brand::after { display:none; }
.roll .brand-logo { width:43mm; height:16mm; margin:auto; filter:brightness(0); }
.roll .brand-site,.roll .eyebrow { display:none; }
.roll .document-identity { text-align:center; margin-top:2mm; }
.roll h1 { font-size:17px; color:#000; }
.roll .order-reference { justify-content:center; margin:0; }
.roll .order-reference span,.roll .date { color:#000; font-size:9px; }
.roll .order-reference bdi { font-size:20px; }
.roll .information { display:block; padding:3mm 0; }
.roll .info-card { border:0; padding:0; }
.roll .info-card h3 { display:none; }
.roll .customer-name { font-size:13px; margin-bottom:1mm; }
.roll .detail { grid-template-columns:18mm minmax(0,1fr); gap:1mm; margin-bottom:1mm; }
.roll .detail dt { color:#000; font-size:9px; }
.roll .detail dd { font-size:11px; }
.roll .delivery { margin-top:2mm; border-top:1px dashed #777; padding-top:2mm; }
.roll h2 { font-size:12px; }
.roll .section-heading { margin-bottom:1.5mm; }
.roll .section-heading span { color:#000; }
.roll .items th { background:white; color:black; padding:1.5mm 1mm; border-block:1.5px solid black; }
.roll .items td { font-size:10px; padding:2mm 1mm; border-bottom:1px dashed #999; }
.roll .items tbody tr { background:white; }
.roll .items .index { display:none; }
.roll .items .product { width:53%; }
.roll .items .quantity { width:12%; }
.roll .items .amount { width:35%; }
.roll .closing { display:flex; flex-direction:column-reverse; gap:2mm; padding:2mm 0 3mm; }
.roll .order-note { padding:0; }
.roll .order-note h3 { display:none; }
.roll .order-note p { font-size:9px; color:black; }
.roll .grand { background:white; border-block:2px solid black; padding:2mm 0; margin-top:1mm; }
.roll .grand bdi { color:black; font-size:15px; }
.roll .document-footer { border-top:1px solid black; padding-top:3mm; display:flex; flex-direction:column-reverse; gap:2mm; }
.roll .barcode { width:61mm; height:14mm; }
.roll .scan { width:100%; justify-content:space-between; }
.roll .qr { width:19mm; height:19mm; }
.roll .contact { font-size:9px; }
.roll .contact strong { color:#000; font-size:8px; }
.roll .thanks { color:#000; font-size:8px; padding-top:2mm; }
.thermal-receipt .document-footer,
.thermal-receipt .contact,
.thermal-receipt .tracking,
.thermal-receipt .thanks { font-weight:700; }
.shipping-label .customer-name { font-size:16px; }
.shipping-label .items .product { width:83%; }
.shipping-label .items .quantity { width:17%; }
`;
