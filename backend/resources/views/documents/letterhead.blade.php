{{-- ST2b: the letterhead block with the document title on the right; $title, $number and $meta (extra lines). --}}
@php
    $logo = is_string($letterhead['logo'] ?? null) && str_starts_with($letterhead['logo'], 'data:image/') ? $letterhead['logo'] : null;
    $contact = array_values(array_filter([$letterhead['address'] ?? null, $letterhead['phone'] ?? null, $letterhead['email'] ?? null]));
@endphp
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
        <h1>{{ $title }}</h1>
        <p>{{ $number }}</p>
        @foreach ($meta as $line)
            <p>{{ $line }}</p>
        @endforeach
    </div>
</header>
