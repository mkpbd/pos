<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Goods receipt {{ $receipt['number'] }}</title>
<style>
@include('documents.styles')
</style>
</head>
<body>
@include('documents.letterhead', ['title' => 'Goods receipt', 'number' => $receipt['number'], 'meta' => ['Date: '.$receipt['date']]])

<section class="parties">
    <div>
        <p class="label">Supplier</p>
        @if ($supplier)
            <p class="value"><strong>{{ $supplier['name'] }}</strong> ({{ $supplier['code'] }})</p>
            @if (! empty($supplier['address']))
                <p class="value">{{ $supplier['address'] }}</p>
            @endif
        @endif
    </div>
    <div>
        <p class="label">Supplier invoice</p>
        <p class="value"><strong>{{ $receipt['invoice_number'] ?? '—' }}</strong></p>
        <p class="value">Invoice date: {{ $receipt['invoice_date'] }}</p>
        @if ($receipt['due_date'])
            <p class="value">Due: {{ $receipt['due_date'] }}</p>
        @endif
    </div>
    <div>
        <p class="label">Received into</p>
        <p class="value"><strong>{{ $store }}</strong></p>
        @if ($receipt['order_number'])
            <p class="label" style="margin-top:4px">Purchase order</p>
            <p class="value">{{ $receipt['order_number'] }}</p>
        @endif
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
            <th class="right">Effective cost</th>
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
                <td class="right">{{ $line['effective_cost'] }}</td>
                <td class="right">{{ $line['tax'] }}</td>
                <td class="right">{{ $line['total'] }}</td>
            </tr>
        @endforeach
    </tbody>
</table>

@if ($charges !== [])
    <p class="label" style="margin-top:10px">Charges</p>
    <table>
        <thead>
            <tr><th>Charge</th><th>Description</th><th class="right">Amount</th><th class="right">Tax</th></tr>
        </thead>
        <tbody>
            @foreach ($charges as $charge)
                <tr>
                    <td>{{ $charge['type'] }}</td>
                    <td>{{ $charge['description'] }}</td>
                    <td class="right">{{ $charge['amount'] }}</td>
                    <td class="right">{{ $charge['tax'] }}</td>
                </tr>
            @endforeach
        </tbody>
    </table>
@endif

<table class="totals">
    <tr><td>Goods subtotal (after discounts)</td><td class="right">{{ $receipt['subtotal'] }}</td></tr>
    <tr><td>Goods tax</td><td class="right">{{ $receipt['tax_total'] }}</td></tr>
    <tr><td>Goods total</td><td class="right">{{ $receipt['total'] }}</td></tr>
    @if ($charges !== [])
        <tr><td>Charges</td><td class="right">{{ $receipt['charges_total'] }}</td></tr>
        <tr><td>Charges tax</td><td class="right">{{ $receipt['charges_tax_total'] }}</td></tr>
    @endif
    <tr class="grand"><td>Payable to supplier ({{ $receipt['currency'] }})</td><td class="right">{{ $receipt['payable_total'] }}</td></tr>
</table>

@if (! empty($receipt['notes']))
    <div class="notes"><p class="label">Notes</p>{{ $receipt['notes'] }}</div>
@endif

<section class="signatures">
    <div>Received by</div>
    <div>Checked by</div>
</section>
</body>
</html>
