<?php

namespace App\Modules\Marketing\Application\Actions;

use App\Modules\Marketing\Domain\BotUserAgents;
use App\Modules\Marketing\Domain\ShortLinkTarget;
use App\Modules\Marketing\Infrastructure\Models\ShortLink;
use App\Modules\Shared\Domain\CampaignAttribution;
use Illuminate\Support\Facades\DB;

/**
 * P2a: `/go/<code>` on the store host — where the short link sends the visitor (its store path
 * with its UTM parameters, the campaign's `utm_campaign` when the link has none, and
 * `sl=<code>`), counting the click (atomic increment; bots are not counted). An unknown or
 * inactive code (or another store's) sends the visitor to the home page.
 */
class FollowShortLink
{
    public function __invoke(string $code, ?string $userAgent): string
    {
        $code = CampaignAttribution::code($code);
        $link = $code === null ? null : ShortLink::query()->with('campaign')->where('code', $code)->where('active', true)->first();
        if ($link === null || ! ShortLinkTarget::isValid($link->target_path)) {
            return '/';
        }
        if (! BotUserAgents::isBot($userAgent)) {
            ShortLink::query()->whereKey($link->id)->update([
                'clicks' => DB::raw('clicks + 1'),
                'last_clicked_at' => now(),
            ]);
        }

        return ShortLinkTarget::redirect($link->target_path, [
            'source' => $link->utm_source,
            'medium' => $link->utm_medium,
            'campaign' => $link->utm_campaign ?? $link->campaign?->utm_campaign,
            'content' => $link->utm_content,
            'term' => $link->utm_term,
        ], $link->code);
    }
}
