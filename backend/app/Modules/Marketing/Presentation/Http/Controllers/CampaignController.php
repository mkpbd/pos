<?php

namespace App\Modules\Marketing\Presentation\Http\Controllers;

use App\Modules\Marketing\Application\Actions\ManageCampaigns;
use App\Modules\Marketing\Application\Contracts\LandingPages;
use App\Modules\Marketing\Infrastructure\Models\Campaign;
use App\Modules\Marketing\Presentation\Http\Support\MarketingPresenter;
use App\Modules\Shared\Infrastructure\Http\Queries\ListQuery;
use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Validation\Rule;

/**
 * P2a: marketing campaigns (Marketing → Campaigns).
 */
class CampaignController
{
    public function __construct(private readonly MarketingPresenter $presenter) {}

    /**
     * Campaigns
     *
     * Filters `status` (active | archived), `search` (name, slug, utm_campaign). Newest first.
     * Rows: `{id, name, slug, utm_campaign, landing_document: {id, title, slug, path,
     * published}|null, starts_at, ends_at, status, short_links_count, created_at, updated_at}`.
     */
    public function index(Request $request): JsonResponse
    {
        $request->validate([
            'status' => ['sometimes', Rule::in(Campaign::STATUSES)],
            'search' => ['sometimes', 'nullable', 'string', 'max:100'],
        ]);
        $search = trim((string) $request->query('search', ''));
        $page = Campaign::query()
            ->when($request->query('status'), fn (Builder $q, string $v) => $q->where('status', $v))
            ->when($search !== '', fn (Builder $q) => $q->where(function (Builder $w) use ($search) {
                foreach (['name', 'slug', 'utm_campaign'] as $column) {
                    $w->orWhereLike($column, '%'.addcslashes($search, '%_\\').'%');
                }
            }))
            ->orderByDesc('created_at')->orderBy('id')
            ->paginate(ListQuery::perPage($request));
        $rows = array_column($this->presenter->campaigns($page->items()), null, 'id');

        return ApiResponse::paginated($page, fn (Campaign $c) => new JsonResource($rows[$c->id]));
    }

    public function show(Campaign $campaign): JsonResponse
    {
        return ApiResponse::success($this->presenter->campaign($campaign));
    }

    /**
     * Create a campaign
     *
     * `{name, slug?, utm_campaign?, landing_document_id?, starts_at?, ends_at?}` — the slug
     * comes from the name, `utm_campaign` from the slug (both unique). 201 with the campaign.
     */
    public function store(Request $request, ManageCampaigns $campaigns): JsonResponse
    {
        $data = $request->validate($this->rules(true));

        return ApiResponse::created($this->presenter->campaign($campaigns->create($data)));
    }

    /**
     * Change a campaign
     *
     * Any of the create fields and `status` (active | archived). Campaigns are archived, never deleted.
     */
    public function update(Request $request, Campaign $campaign, ManageCampaigns $campaigns): JsonResponse
    {
        $data = $request->validate($this->rules(false));

        return ApiResponse::success($this->presenter->campaign($campaigns->update($campaign, $data)));
    }

    /**
     * Landing pages
     *
     * The store's landing pages a campaign can point to: `[{id, title, slug, path, published}]`.
     */
    public function landingPages(LandingPages $pages): JsonResponse
    {
        return ApiResponse::success($pages->all());
    }

    /**
     * @return array<string, list<mixed>>
     */
    private function rules(bool $creating): array
    {
        $required = $creating ? 'required' : 'sometimes';

        return [
            'name' => [$required, 'string', 'min:1', 'max:120'],
            'slug' => ['sometimes', 'nullable', 'string', 'regex:/^[a-z0-9]+(?:-[a-z0-9]+)*$/', 'min:2', 'max:60'],
            'utm_campaign' => ['sometimes', 'nullable', 'string', 'max:100', 'regex:/^[^\s\x00-\x1F]+$/u'],
            'landing_document_id' => ['sometimes', 'nullable', 'uuid'],
            'starts_at' => ['sometimes', 'nullable', 'date'],
            'ends_at' => ['sometimes', 'nullable', 'date'],
            'status' => ['sometimes', Rule::in(Campaign::STATUSES)],
        ];
    }
}
