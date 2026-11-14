<?php

namespace App\Modules\Marketing\Presentation\Http\Controllers;

use App\Modules\Marketing\Application\Actions\ManageShortLinks;
use App\Modules\Marketing\Domain\ShortLinkTarget;
use App\Modules\Marketing\Infrastructure\Models\ShortLink;
use App\Modules\Marketing\Presentation\Http\Support\MarketingPresenter;
use App\Modules\Shared\Domain\CampaignAttribution;
use App\Modules\Shared\Infrastructure\Http\Queries\ListQuery;
use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use Closure;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * P2a: short links `https://<store host>/go/<code>` (Marketing → Short links).
 */
class ShortLinkController
{
    public function __construct(private readonly MarketingPresenter $presenter) {}

    /**
     * Short links
     *
     * Filters `campaign_id`, `search` (code, target path). Newest first. Rows: `{id, code,
     * target_path, campaign: {id, name}|null, utm: {source, medium, campaign, content, term},
     * clicks, last_clicked_at, active, url (null without a store domain), created_at, updated_at}`.
     */
    public function index(Request $request): JsonResponse
    {
        $request->validate([
            'campaign_id' => ['sometimes', 'uuid'],
            'search' => ['sometimes', 'nullable', 'string', 'max:100'],
        ]);
        $search = trim((string) $request->query('search', ''));
        $page = ShortLink::query()
            ->with('campaign')
            ->when($request->query('campaign_id'), fn (Builder $q, string $v) => $q->where('campaign_id', strtolower($v)))
            ->when($search !== '', fn (Builder $q) => $q->where(function (Builder $w) use ($search) {
                $w->orWhereLike('code', '%'.addcslashes(mb_strtolower($search), '%_\\').'%')
                    ->orWhereLike('target_path', '%'.addcslashes($search, '%_\\').'%');
            }))
            ->orderByDesc('created_at')->orderBy('id')
            ->paginate(ListQuery::perPage($request));
        $rows = array_column($this->presenter->shortLinks($page->items()), null, 'id');

        return ApiResponse::paginated($page, fn (ShortLink $l) => new JsonResource($rows[$l->id]));
    }

    public function show(ShortLink $shortLink): JsonResponse
    {
        return ApiResponse::success($this->presenter->shortLink($shortLink));
    }

    /**
     * Create a short link
     *
     * `{code? ([a-z0-9-]{3,32}; random six characters when left out), target_path (a store path
     * such as /p/eid-sale), campaign_id?, utm?: {source, medium, campaign, content, term},
     * active?}` → 201. Errors: field errors (code taken → `code`).
     */
    public function store(Request $request, ManageShortLinks $links): JsonResponse
    {
        $this->lowerCode($request);
        $data = $request->validate($this->rules(true));

        return ApiResponse::created($this->presenter->shortLink($links->create($data)));
    }

    public function update(Request $request, ShortLink $shortLink, ManageShortLinks $links): JsonResponse
    {
        $this->lowerCode($request);
        $data = $request->validate($this->rules(false));

        return ApiResponse::success($this->presenter->shortLink($links->update($shortLink, $data)));
    }

    public function destroy(ShortLink $shortLink, ManageShortLinks $links): JsonResponse
    {
        $links->delete($shortLink);

        return ApiResponse::noContent();
    }

    private function lowerCode(Request $request): void
    {
        if (is_string($request->input('code'))) {
            $request->merge(['code' => mb_strtolower(trim($request->input('code')))]);
        }
    }

    /**
     * @return array<string, list<mixed>>
     */
    private function rules(bool $creating): array
    {
        $utm = ['sometimes', 'nullable', 'string', 'max:'.CampaignAttribution::UTM_MAX];

        return [
            'code' => ['sometimes', 'nullable', 'string', 'regex:'.CampaignAttribution::CODE_PATTERN],
            'target_path' => [$creating ? 'required' : 'sometimes', 'string', 'max:'.ShortLinkTarget::MAX, function (string $attribute, mixed $value, Closure $fail) {
                if (! ShortLinkTarget::isValid($value)) {
                    $fail('Enter a path of your store, such as /p/eid-sale or /product/my-product.');
                }
            }],
            'campaign_id' => ['sometimes', 'nullable', 'uuid'],
            'utm' => ['sometimes', 'nullable', 'array'],
            'utm.source' => $utm,
            'utm.medium' => $utm,
            'utm.campaign' => $utm,
            'utm.content' => $utm,
            'utm.term' => $utm,
            'active' => ['sometimes', 'boolean'],
        ];
    }
}
