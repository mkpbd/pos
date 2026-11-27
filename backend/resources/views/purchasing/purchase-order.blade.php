@php
    $supplierContact = array_values(array_filter([$supplier['contact_person'] ?? null, $supplier['email'] ?? null, $supplier['phone'] ?? null]));
@endphp
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Purchase order {{ $order['number'] }}</title>
<style>
@include('documents.styles')
</style>
</head>
<body>
@include('documents.letterhead', ['title' => 'Purchase order', 'number' => $order['number'], 'meta' => ['Date: '.$order['date']]])

<section class="parties">
    <div>
        <p class="label">Supplier</p>
        @if ($supplier)
            <p class="value"><strong>{{ $supplier['name'] }}</strong> ({{ $supplier['code'] }})</p>
            @if ($supplierContact !== [])
                <p class="value">{{ implode(' · ', $supplierContact) }}</p>
            @endif
            @if (! empty($supplier['address']))
                <p class="value">{{ $supplier['address'] }}</p>
            @endif
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
        <p class="label">Expected delivery</p>
        <p class="value"><strong>{{ $order['expected'] ?? '—' }}</strong></p>
        <p class="label" style="margin-top:4px">Payment terms</p>
        <p class="value">{{ $order['payment_terms'] }}</p>
    </div>
</section>

<table>
    <thead>
        <tr>
            <th class="right">#</th>
            <th>SKU</th>
            <th>Item</th>
            <th class="right">Quantity</th>
            <th class="right">Free qty</th>
            <th class="right">Unit cost</th>
            <th class="right">Disc %</th>
            <th class="right">Tax</th>
            <th class="right">Line total</th>
        </tr>
    </thead>
    <tbody>
        @foreach ($lines as $i => $line)
            <tr>
                <td class="right">{{ $i + 1 }}</td>
                <td>{{ $line['sku'] }}</td>
                <td>{{ $line['name'] }}</td>
                <td class="right">{{ $line['quantity'] }} {{ $line['unit'] }}</td>
                <td class="right">{{ $line['bonus'] }}</td>
                <td class="right">{{ $line['unit_cost'] }}</td>
                <td class="right">{{ $line['discount'] }}</td>
                <td class="right">{{ $line['tax'] }}</td>
                <td class="right">{{ $line['total'] }}</td>
            </tr>
        @endforeach
    </tbody>
</table>

<table class="totals">
    <tr><td>Subtotal (after discounts)</td><td class="right">{{ $order['subtotal'] }}</td></tr>
    <tr><td>Tax</td><td class="right">{{ $order['tax_total'] }}</td></tr>
    <tr class="grand"><td>Total ({{ $order['currency'] }})</td><td class="right">{{ $order['total'] }}</td></tr>
</table>

@if (! empty($order['notes']))
    <div class="notes"><p class="label">Notes</p>{{ $order['notes'] }}</div>
@endif

<p class="notes">Please quote {{ $order['number'] }} on your delivery note and invoice.</p>
</body>
</html>
