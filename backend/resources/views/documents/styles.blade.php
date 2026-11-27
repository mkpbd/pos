{{-- ST2b: shared A4 document styles (PO, goods receipt, transfer challan), as the RFQ document. --}}
{!! $fontCss !!}
@page { size: A4 portrait; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body { font-family: 'Poppins', 'Hind Siliguri', sans-serif; font-size: 9.5pt; color: #1f2933; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.letterhead { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; border-bottom: 2px solid #1f3a5f; padding-bottom: 6px; margin-bottom: 10px; }
.letterhead .org { display: flex; gap: 10px; align-items: center; }
.letterhead img { max-height: 42px; max-width: 120px; object-fit: contain; }
.org-name { font-size: 13pt; font-weight: 600; margin: 0; }
.org-meta { font-size: 8pt; color: #52606d; margin: 1px 0 0; }
.doc-title { text-align: right; }
.doc-title h1 { font-size: 14pt; font-weight: 600; margin: 0; }
.doc-title p { margin: 1px 0 0; font-size: 9pt; }
.parties { display: flex; gap: 16px; margin-bottom: 10px; }
.parties > div { flex: 1; border: 1px solid #e4e7eb; border-radius: 4px; padding: 6px 8px; }
.label { font-size: 7.5pt; text-transform: uppercase; letter-spacing: .04em; color: #52606d; margin: 0 0 2px; }
.value { margin: 0; }
table { width: 100%; border-collapse: collapse; }
thead { display: table-header-group; }
tr { page-break-inside: avoid; break-inside: avoid; }
th { background: #e8eef5; font-weight: 600; text-align: left; border-bottom: 1px solid #9aa5b1; }
th, td { padding: 4px 6px; vertical-align: top; overflow-wrap: anywhere; }
td { border-bottom: 1px solid #e4e7eb; }
.right { text-align: right; white-space: nowrap; }
.totals { margin-top: 8px; margin-left: auto; width: 45%; }
.totals td { border-bottom: none; padding: 2px 6px; }
.totals tr.grand td { border-top: 1px solid #9aa5b1; font-weight: 600; }
.notes { margin-top: 10px; white-space: pre-line; }
.signatures { display: flex; gap: 40px; margin-top: 48px; }
.signatures > div { flex: 1; border-top: 1px solid #52606d; padding-top: 4px; }
