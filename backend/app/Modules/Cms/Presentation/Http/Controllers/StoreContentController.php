<?php

namespace App\Modules\Cms\Presentation\Http\Controllers;

use App\Modules\Cms\Application\Actions\ContactMessages;
use App\Modules\Cms\Application\Actions\NewsletterSubscriptions;
use App\Modules\Cms\Domain\PageTemplate;
use App\Modules\Cms\Infrastructure\Models\CmsPage;
use App\Modules\Cms\Infrastructure\Models\FaqItem;
use App\Modules\Cms\Presentation\Http\Support\CmsPresenter;
use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Public content endpoints of the storefront (organization from the host name).
 */
class StoreContentController
{
    /**
     * Content page
     *
     * A published page by slug; drafts, scheduled and deleted pages are 404. Pages with the
     * `faq` template include the active FAQ entries, grouped.
     */
    public function page(string $slug): JsonResponse
    {
        $page = CmsPage::query()->visible()->whereRaw('lower(slug) = ?', [mb_strtolower($slug)])->first();
        if ($page === null) {
            return ApiResponse::error('NOT_FOUND', 'This page does not exist.', 404);
        }

        $data = CmsPresenter::page($page, true);
        unset($data['id'], $data['status'], $data['is_visible']);
        if ($page->template === PageTemplate::Faq) {
            $data['faq'] = CmsPresenter::publicFaq(FaqItem::query()->where('is_active', true)->get());
        }

        return ApiResponse::success($data);
    }

    /**
     * FAQ
     *
     * Active entries, grouped, in display order.
     */
    public function faq(): JsonResponse
    {
        return ApiResponse::success(CmsPresenter::publicFaq(FaqItem::query()->where('is_active', true)->get()));
    }

    /**
     * Send a contact message
     *
     * Limited to 5 per hour per visitor. `website` is a honeypot that must stay empty.
     */
    public function contact(Request $request, ContactMessages $messages): JsonResponse
    {
        $data = $request->validate([
            'name' => ['required', 'string', 'max:120'],
            'email' => ['required', 'email:rfc', 'max:254'],
            'phone' => ['sometimes', 'nullable', 'string', 'max:20'],
            'subject' => ['sometimes', 'nullable', 'string', 'max:160'],
            'message' => ['required', 'string', 'min:10', 'max:5000'],
            'website' => ['sometimes', 'nullable', 'string', 'max:255'],
        ]);
        $messages->submit($data, $request->ip());

        return ApiResponse::success(['message' => 'Thank you. We will get back to you soon.'], 202);
    }

    /**
     * Subscribe to the newsletter
     *
     * Sends a confirmation e-mail (double opt-in). The answer is the same whether or not the
     * address is already subscribed. Limited to 5 per hour per visitor.
     */
    public function subscribe(Request $request, NewsletterSubscriptions $newsletter): JsonResponse
    {
        $data = $request->validate(['email' => ['required', 'email:rfc', 'max:254']]);
        $newsletter->subscribe($data['email'], $request->ip(), $request->getSchemeAndHttpHost());

        return ApiResponse::success(['message' => 'Almost done: check your inbox and confirm your subscription.'], 202);
    }

    /**
     * Confirm a newsletter subscription
     *
     * With the token from the confirmation e-mail. `TOKEN_INVALID` for unknown or expired tokens.
     */
    public function confirm(Request $request, NewsletterSubscriptions $newsletter): JsonResponse
    {
        $newsletter->confirm($request->validate(['token' => ['required', 'string', 'max:100']])['token']);

        return ApiResponse::success(['message' => 'Your subscription is confirmed.']);
    }

    /**
     * Unsubscribe from the newsletter
     *
     * With the token from the e-mail. Repeating it succeeds.
     */
    public function unsubscribe(Request $request, NewsletterSubscriptions $newsletter): JsonResponse
    {
        $newsletter->unsubscribe($request->validate(['token' => ['required', 'string', 'max:100']])['token']);

        return ApiResponse::success(['message' => 'You have been unsubscribed.']);
    }
}
