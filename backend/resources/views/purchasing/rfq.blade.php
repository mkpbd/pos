@php
    /** @var array<string, mixed> $letterhead */
    $logo = is_string($letterhead['logo'] ?? null) && str_starts_with($letterhead['logo'], 'data:image/') ? $letterhead['logo'] : null;
    $contact = array_values(array_filter([$letterhead['address'] ?? null, $letterhead['phone'] ?? null, $letterhead['email'] ?? null]));
    $supplierContact = array_values(array_filter([$supplier['contact_person'] ?? null, $supplier['email'] ?? null, $supplier['phone'] ?? null]));
@endphp
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Request for quotation {{ $rfq['number'] }}</title>
<style>
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
.subject { font-weight: 600; margin: 0 0 8px; }
table { width: 100%; border-collapse: collapse; }
thead { display: table-header-group; }
tr { page-break-inside: avoid; break-inside: avoid; }
th { background: #e8eef5; font-weight: 600; text-align: left; border-bottom: 1px solid #9aa5b1; }
th, td { padding: 4px 6px; vertical-align: top; overflow-wrap: anywhere; }
td { border-bottom: 1px solid #e4e7eb; }
.right { text-align: right; white-space: nowrap; }
.blank { border-bottom: 1px solid #9aa5b1; min-width: 70px; }
.notes { margin-top: 10px; white-space: pre-line; }
.instructions { margin-top: 12px; font-size: 8.5pt; color: #3e4c59; }
</style>
</head>
<body>
<header class="letterhead">
    <div class="org">
        @if ($logo)
            <img src="{{ $logo }}" alt="">
        @endif
        <div>
            <p class="org-name">{{ $letterhead['name'] }}</p>
            @if (! empty($letterhead['legal_name']) && $letterhead['legal_name'] !== $letterhead['name'])
                <p class="org-meta">{{ $letterhead['legal_name'] }}</p>
            @endif
            @if ($contact !== [])
                <p class="org-meta">{{ implode(' · ', $contact) }}</p>
            @endif
            @if (! empty($letterhead['tax_number']))
                <p class="org-meta">Tax no. {{ $letterhead['tax_number'] }}</p>
            @endif
        </div>
    </div>
    <div class="doc-title">
        <h1>Request for quotation</h1>
        <p>{{ $rfq['number'] }}</p>
        <p>Date: {{ $rfq['date'] }}</p>
    </div>
</header>

<section class="parties">
    <div>
        <p class="label">To</p>
        <p class="value"><strong>{{ $supplier['name'] }}</strong> ({{ $supplier['code'] }})</p>
        @if ($supplierContact !== [])
            <p class="value">{{ implode(' · ', $supplierContact) }}</p>
        @endif
        @if (! empty($supplier['address']))
            <p class="value">{{ $supplier['address'] }}</p>
        @endif
    </div>
    <div>
        <p class="label">Deliver to</p>
        <p class="value"><strong>{{ $deliverTo['name'] }}</strong></p>
        @if (! empty($deliverTo['address']))
            <p class="value">{{ $deliverTo['address'] }}</p>
        @endif
        @if (! empty($deliverTo['phone']))
            <p class="value">{{ $deliverTo['phone'] }}</p>
        @endif
    </div>
    <div>
        <p class="label">Please reply by</p>
        <p class="value"><strong>{{ $rfq['reply_by'] ?? '—' }}</strong></p>
        <p class="label" style="margin-top:4px">Needed by</p>
        <p class="value">{{ $rfq['needed_by'] ?? '—' }}</p>
    </div>
</section>

<p class="subject">{{ $rfq['title'] }}</p>

<table>
    <thead>
        <tr>
            <th class="right">#</th>
            <th>SKU</th>
            <th>Item</th>
            <th class="right">Quantity</th>
            <th>Unit</th>
            <th class="right">Your unit price</th>
            <th class="right">Lead time (days)</th>
        </tr>
    </thead>
    <tbody>
        @foreach ($lines as $i => $line)
            <tr>
                <td class="right">{{ $i + 1 }}</td>
                <td>{{ $line['sku'] }}</td>
                <td>{{ $line['name'] }}@if (! empty($line['notes']))<br><small>{{ $line['notes'] }}</small>@endif</td>
                <td class="right">{{ $line['quantity'] }}</td>
                <td>{{ $line['unit'] }}</td>
                <td class="blank"></td>
                <td class="blank"></td>
            </tr>
        @endforeach
    </tbody>
</table>

@if (! empty($rfq['notes']))
    <div class="notes"><p class="label">Notes</p>{{ $rfq['notes'] }}</div>
@endif

<p class="instructions">
    Please quote your unit price (excluding tax) and lead time for each item, how long your prices are valid,
    and any quantity you cannot supply. Reply by {{ $rfq['reply_by'] ?? 'return' }} quoting {{ $rfq['number'] }}@if (! empty($letterhead['email'])) to {{ $letterhead['email'] }}@endif.
</p>
</body>
</html>
