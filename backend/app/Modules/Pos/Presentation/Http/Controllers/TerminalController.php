<?php

namespace App\Modules\Pos\Presentation\Http\Controllers;

use App\Modules\Authentication\Application\Actions\PinSignIn;
use App\Modules\Authentication\Application\Contracts\TillDevices;
use App\Modules\Authentication\Application\Contracts\TillPins;
use App\Modules\Pos\Application\Actions\RevokeTerminal;
use App\Modules\Pos\Application\Actions\SetUpTerminal;
use App\Modules\Pos\Application\Queries\TerminalList;
use App\Modules\Pos\Application\Services\TerminalCookie;
use App\Modules\Pos\Application\Services\TerminalRegistry;
use App\Modules\Shared\Application\Contracts\TenantUser;
use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

/**
 * POS1a: tills — devices set up to sell at one store, where cashiers sign in with their PIN.
 */
class TerminalController
{
    /**
     * List tills
     *
     * Tills of the stores in the user's branches, active first. `is_this_device` marks the till
     * of the calling browser.
     */
    public function index(Request $request, TerminalList $list): JsonResponse
    {
        return ApiResponse::success($list->forUser($this->user($request), TerminalCookie::tokenHash($request)));
    }

    /**
     * Set up this device as a till
     *
     * Answers the till and sets the `pos_terminal` cookie (httpOnly, 400 days). A till this
     * device already was is revoked.
     */
    public function store(Request $request, SetUpTerminal $setUp, TerminalList $list): JsonResponse
    {
        $data = $request->validate([
            'store_id' => ['required', 'uuid'],
            'name' => ['required', 'string', 'max:60'],
        ]);
        $user = $this->user($request);
        $result = $setUp($user, $data['store_id'], trim($data['name']), TerminalCookie::tokenHash($request));
        $terminal = $list->present(collect([$result['terminal']]), $user, TerminalCookie::hash($result['token']))[0];

        return ApiResponse::created($terminal)->withCookie(TerminalCookie::make($result['token']));
    }

    /**
     * Revoke a till
     *
     * Its device can no longer be used to sign in with a PIN.
     */
    public function destroy(Request $request, string $terminal, TerminalList $list, RevokeTerminal $revoke): JsonResponse
    {
        $found = $list->find($this->user($request), $terminal) ?? throw new NotFoundHttpException;
        $revoke($found);

        return ApiResponse::noContent();
    }

    /**
     * This device's till
     *
     * For the PIN sign-in screen: the till, its store and the people who can sign in here (active,
     * `pos.sell`, the store's branch, a PIN set), by name. `TERMINAL_NOT_FOUND` (404) when this
     * device is not a till (or the till was revoked).
     *
     * @unauthenticated
     */
    public function current(Request $request, TerminalRegistry $registry, TillPins $pins): JsonResponse
    {
        $resolved = $registry->resolve($request);
        if ($resolved === null) {
            // Asked by every sign-in page on every device: an answer, not an exception (nothing to log).
            $missing = PinSignIn::terminalNotFound();

            return ApiResponse::error($missing->errorCode, $missing->getMessage(), 404);
        }
        $terminal = $resolved['terminal'];
        $store = $resolved['store'];

        return ApiResponse::success([
            'id' => $terminal->id,
            'name' => $terminal->name,
            'store' => ['id' => $store['id'], 'name' => $store['name'], 'branch_id' => $store['branch_id']],
            'users' => $pins->candidates($terminal->organization_id, $store['branch_id'], TillDevices::SIGN_IN_PERMISSION),
        ]);
    }

    private function user(Request $request): TenantUser
    {
        /** @var TenantUser */
        return $request->user();
    }
}
