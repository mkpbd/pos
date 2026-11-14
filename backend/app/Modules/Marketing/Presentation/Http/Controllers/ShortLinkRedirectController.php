<?php

namespace App\Modules\Marketing\Presentation\Http\Controllers;

use App\Modules\Marketing\Application\Actions\FollowShortLink;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;

/**
 * P2a: `GET /go/{code}` on the store host — 302 to the short link's target with its UTM
 * parameters and `sl=<code>` (the click is counted); unknown or inactive → 302 to `/`.
 */
class ShortLinkRedirectController
{
    public function __invoke(Request $request, string $code, FollowShortLink $follow): RedirectResponse
    {
        $target = $follow($code, $request->userAgent());

        return redirect()->to($target, 302)->withHeaders([
            'Cache-Control' => 'no-store, private',
            'X-Robots-Tag' => 'noindex',
        ]);
    }
}
