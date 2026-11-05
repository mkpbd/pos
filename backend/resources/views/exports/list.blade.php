@php
    /** @var \App\Modules\Shared\Application\Export\ExportDocument $document */
    $letterhead = $document->letterhead;
    $logo = is_string($letterhead['logo'] ?? null) && str_starts_with($letterhead['logo'], 'data:image/') ? $letterhead['logo'] : null;
    $contact = array_values(array_filter([$letterhead['address'] ?? null, $letterhead['phone'] ?? null, $letterhead['email'] ?? null]));
@endphp
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>{{ $document->title }}</title>
<style>
{!! $fontCss !!}
@page { size: A4 {{ $landscape ? 'landscape' : 'portrait' }}; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body { font-family: 'Poppins', 'Hind Siliguri', sans-serif; font-size: 9pt; color: #1f2933; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.letterhead { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; border-bottom: 2px solid #1f3a5f; padding-bottom: 6px; margin-bottom: 8px; }
.letterhead .org { display: flex; gap: 10px; align-items: center; }
.letterhead img { max-height: 42px; max-width: 120px; object-fit: contain; }
.org-name { font-size: 13pt; font-weight: 600; margin: 0; }
.org-meta { font-size: 8pt; color: #52606d; margin: 1px 0 0; }
.doc-meta { text-align: right; font-size: 8pt; color: #52606d; }
h1 { font-size: 12pt; font-weight: 600; margin: 0 0 2px; }
.filters { font-size: 8pt; color: #3e4c59; margin: 0 0 8px; }
table { width: 100%; border-collapse: collapse; }
thead { display: table-header-group; }
tfoot { display: table-footer-group; }
tr { page-break-inside: avoid; break-inside: avoid; }
th { background: #e8eef5; font-weight: 600; text-align: left; border-bottom: 1px solid #9aa5b1; }
th, td { padding: 3px 5px; vertical-align: top; overflow-wrap: anywhere; }
td { border-bottom: 1px solid #e4e7eb; }
tbody tr:nth-child(even) td { background: #f8fafc; }
.right { text-align: right; white-space: nowrap; }
.center { text-align: center; }
.count { font-size: 8pt; color: #52606d; margin-top: 6px; }
.empty { padding: 12px; text-align: center; color: #52606d; }
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
    <div class="doc-meta">
        <div>Generated {{ $generatedAt }}</div>
        @if ($document->generatedBy)
            <div>by {{ $document->generatedBy }}</div>
        @endif
    </div>
</header>
<h1>{{ $document->title }}</h1>
<p class="filters">{{ $document->filterSummary() }}</p>
<table>
    <thead>
        <tr>
            @foreach ($columns as $column)
                <th class="{{ $column->alignment() }}">{{ $column->label }}</th>
            @endforeach
        </tr>
    </thead>
    <tbody>
        @forelse ($rows as $row)
            <tr>
                @foreach ($row as $i => $cell)
                    <td class="{{ $columns[$i]->alignment() }}">{{ $cell }}</td>
                @endforeach
            </tr>
        @empty
            <tr><td class="empty" colspan="{{ count($columns) }}">No records match these filters.</td></tr>
        @endforelse
    </tbody>
</table>
<p class="count">{{ number_format(count($rows)) }} {{ count($rows) === 1 ? 'record' : 'records' }}</p>
</body>
</html>
