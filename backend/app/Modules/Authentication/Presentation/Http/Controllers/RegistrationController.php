<?php

namespace App\Modules\Authentication\Presentation\Http\Controllers;

use App\Modules\Authentication\Application\Actions\StartSession;
use App\Modules\Authentication\Presentation\Http\Resources\CurrentUserResource;
use App\Modules\Organizations\Application\Actions\ProvisionOrganization;
use App\Modules\Organizations\Application\DTOs\ProvisionOrganizationData;
use App\Modules\Organizations\Presentation\Http\Requests\ProvisionOrganizationRequest;
use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use Illuminate\Http\JsonResponse;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

class RegistrationController
{
    /**
     * Sign up
     *
     * Creates a new organization (with main branch and built-in roles) and its first
     * Organization Admin, then starts a session. Disabled when POS_REGISTRATION_ENABLED=false.
     *
     * @unauthenticated
     */
    public function __invoke(ProvisionOrganizationRequest $request, ProvisionOrganization $provision, StartSession $startSession): JsonResponse
    {
        if (! config('pos.registration_enabled')) {
            throw new NotFoundHttpException;
        }

        $result = $provision(ProvisionOrganizationData::fromArray($request->validated()));
        $startSession($result['admin']);

        return ApiResponse::created(new CurrentUserResource($result['admin']));
    }
}
