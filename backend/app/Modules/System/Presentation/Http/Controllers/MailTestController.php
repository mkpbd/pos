<?php

namespace App\Modules\System\Presentation\Http\Controllers;

use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use App\Modules\System\Application\Actions\SendTestMail;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * G1b: "Send test e-mail" — synchronous, so the mailer's error surfaces (422 MAIL_FAILED).
 */
class MailTestController
{
    public function __invoke(Request $request, SendTestMail $send): JsonResponse
    {
        $data = $request->validate(['to' => ['required', 'string', 'email', 'max:255']]);
        $send($data['to']);

        return ApiResponse::success(['sent' => true]);
    }
}
