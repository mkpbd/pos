<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Delivery challan {{ $transfer['number'] }}</title>
<style>
@include('documents.styles')
</style>
</head>
<body>
@include('documents.letterhead', [
    'title' => 'Delivery challan',
    'number' => $transfer['number'],
    'meta' => array_values(array_filter([
        'Status: '.$transfer['status'],
        $transfer['dispatched_at'] ? 'Dispatched: '.$transfer['dispatched_at'] : null,
        $transfer['received_at'] ? 'Received: '.$transfer['received_at'] : null,
    ])),
])

<section class="parties">
    @foreach (['From' => $from, 'To' => $to] as $label => $party)
        <div>
            <p class="label">{{ $label }}</p>
            <p class="value"><strong>{{ $party['name'] }}</strong></p>
            @if (! empty($party['address']))
                <p class="value">{{ $party['address'] }}</p>
            @endif
            @if (! empty($party['phone']))
                <p class="value">{{ $party['phone'] }}</p>
            @endif
        </div>
    @endforeach
</section>

<table>
    <thead>
        <tr>
            <th class="right">#</th>
            <th>SKU</th>
            <th>Item</th>
            <th>Batch / expiry</th>
            <th class="right">Quantity sent</th>
            @if ($received)
                <th class="right">Received</th>
                <th class="right">Damaged</th>
                <th>Remarks</th>
            @endif
        </tr>
    </thead>
    <tbody>
        @foreach ($lines as $i => $line)
            <tr>
                <td class="right">{{ $i + 1 }}</td>
                <td>{{ $line['sku'] }}</td>
                <td>{{ $line['name'] }}</td>
                <td>{{ $line['batch'] ?? '' }}@if ($line['expires_on'])<br><small>Exp. {{ $line['expires_on'] }}</small>@endif</td>
                <td class="right">{{ $line['quantity'] }} {{ $line['unit'] }}</td>
                @if ($received)
                    <td class="right">{{ $line['received'] ?? '' }}</td>
                    <td class="right">{{ $line['damaged'] }}</td>
                    <td>{{ $line['note'] }}</td>
                @endif
            </tr>
        @endforeach
    </tbody>
</table>

@if (! empty($transfer['note']))
    <div class="notes"><p class="label">Note</p>{{ $transfer['note'] }}</div>
@endif

<section class="signatures">
    <div>Dispatched by @if ($transfer['dispatched_by'])<br><small>{{ $transfer['dispatched_by'] }}</small>@endif</div>
    <div>Received by @if ($transfer['received_by'])<br><small>{{ $transfer['received_by'] }}</small>@endif</div>
</section>
</body>
</html>
