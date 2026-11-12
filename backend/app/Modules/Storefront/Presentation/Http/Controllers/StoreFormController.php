<?php

namespace App\Modules\Storefront\Presentation\Http\Controllers;

use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use App\Modules\Storefront\Application\Forms\SubmitBuilderForm;
use App\Modules\Storefront\Presentation\Http\Requests\SubmitBuilderFormRequest;
use Illuminate\Http\JsonResponse;

class StoreFormController
{
    /**
     * Send a builder form
     *
     * Public (B8b). `{values: {<field id>: answer}, consent?: bool, website?: "" (honeypot),
     * page_path?: string}` for the form element `{element}` of the **published** builder document
     * `{document}` (a page, content page design, shop area or popup of this store). Answers:
     * text / e-mail / phone / textarea / date (YYYY-MM-DD) strings, number a number or numeric
     * string, select / radio an option id, checkbox true / false, checkboxes a list of option ids.
     * 202 `{message}` (the form's success message in the request's language) — also when the
     * honeypot is filled (nothing is stored). 404 FORM_NOT_FOUND when the form is not live, 422
     * VALIDATION_ERROR keyed `values.<field id>` / `values.<unknown key>` / `consent`, 413
     * PAYLOAD_TOO_LARGE over 32 KB, 429 over the `forms` limit (POS_FORM_RATE_LIMIT per hour per
     * visitor). Staff with forms.view are notified; the form's extra recipient gets an e-mail.
     */
    public function submit(SubmitBuilderFormRequest $request, string $document, string $element, SubmitBuilderForm $submit): JsonResponse
    {
        $result = $submit($document, $element, $request->validated(), ['ip' => $request->ip(), 'user_agent' => $request->userAgent()]);

        return ApiResponse::success(['message' => $result['message']], 202);
    }
}
