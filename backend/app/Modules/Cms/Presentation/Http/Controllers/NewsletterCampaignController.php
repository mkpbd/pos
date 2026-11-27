<?php

namespace App\Modules\Cms\Presentation\Http\Controllers;

use App\Modules\Cms\Application\Actions\NewsletterCampaigns;
use App\Modules\Cms\Domain\CampaignStatus;
use App\Modules\Cms\Infrastructure\Models\NewsletterCampaign;
use App\Modules\Cms\Presentation\Http\Support\CmsPresenter;
use App\Modules\Shared\Infrastructure\Http\Queries\ListQuery;
use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Validation\Rule;

/**
 * BD2b: newsletter campaigns — markdown drafts sent once to the confirmed subscribers.
 */
class NewsletterCampaignController
{
    /**
     * List newsletter campaigns
     *
     * Newest first, without the body. `?status=draft|sending|sent`; `?search=` matches the subject.
     */
    public function index(Request $request): JsonResponse
    {
        $request->validate(['status' => ['sometimes', Rule::enum(CampaignStatus::class)]]);

        return ApiResponse::paginated(
            ListQuery::paginate(
                NewsletterCampaign::query()->when($request->query('status'), fn (Builder $q, string $status) => $q->where('status', $status)),
                $request,
                ['created_at', 'sent_at', 'subject'],
                ['subject'],
            ),
            fn (NewsletterCampaign $c) => new JsonResource(CmsPresenter::campaign($c, withBody: false)),
        );
    }

    public function show(NewsletterCampaign $newsletterCampaign): JsonResponse
    {
        return ApiResponse::success(CmsPresenter::campaign($newsletterCampaign));
    }

    public function store(Request $request, NewsletterCampaigns $campaigns): JsonResponse
    {
        return ApiResponse::created(CmsPresenter::campaign($campaigns->save(new NewsletterCampaign, $request->validate($this->rules('required')), (string) $request->user()->getAuthIdentifier())));
    }

    /**
     * Update a draft campaign
     *
     * `CAMPAIGN_NOT_DRAFT` once sending started.
     */
    public function update(Request $request, NewsletterCampaign $newsletterCampaign, NewsletterCampaigns $campaigns): JsonResponse
    {
        return ApiResponse::success(CmsPresenter::campaign($campaigns->save($newsletterCampaign, $request->validate($this->rules('sometimes')), (string) $request->user()->getAuthIdentifier())));
    }

    /**
     * Delete a draft campaign
     *
     * `CAMPAIGN_NOT_DRAFT` once sending started.
     */
    public function destroy(NewsletterCampaign $newsletterCampaign, NewsletterCampaigns $campaigns): JsonResponse
    {
        $campaigns->delete($newsletterCampaign);

        return ApiResponse::noContent();
    }

    /**
     * Send a test copy
     *
     * One copy with "[Test]" in the subject to `email`. Limited to 10 per minute per user.
     */
    public function test(Request $request, NewsletterCampaign $newsletterCampaign, NewsletterCampaigns $campaigns): JsonResponse
    {
        $campaigns->sendTest($newsletterCampaign, $request->validate(['email' => ['required', 'email:rfc', 'max:254']])['email']);

        return ApiResponse::success(['message' => 'Test e-mail sent.'], 202);
    }

    /**
     * Send to the confirmed subscribers
     *
     * Starts sending in the background (`status: sending`, then `sent` with `sent_count`).
     * `CAMPAIGN_NOT_DRAFT` when already sent or sending; `NO_SUBSCRIBERS` (422) with nobody to send to.
     */
    public function send(Request $request, NewsletterCampaign $newsletterCampaign, NewsletterCampaigns $campaigns): JsonResponse
    {
        return ApiResponse::success(CmsPresenter::campaign($campaigns->send($newsletterCampaign, (string) $request->user()->getAuthIdentifier())), 202);
    }

    /**
     * Newsletter subscriber counts
     *
     * `{confirmed, pending, unsubscribed}`: campaigns go to the confirmed ones.
     */
    public function subscriberSummary(NewsletterCampaigns $campaigns): JsonResponse
    {
        return ApiResponse::success($campaigns->subscriberSummary());
    }

    /**
     * @return array<string, mixed>
     */
    private function rules(string $required): array
    {
        return [
            'subject' => [$required, 'string', 'max:150'],
            'body' => [$required, 'string', 'max:50000'],
        ];
    }
}
