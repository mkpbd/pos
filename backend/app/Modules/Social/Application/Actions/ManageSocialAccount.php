<?php

namespace App\Modules\Social\Application\Actions;

use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use App\Modules\Social\Infrastructure\Models\SocialAccount;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * P2b: choosing another of the granted Pages, and disconnecting (the stored tokens are deleted).
 * Both audited.
 */
class ManageSocialAccount
{
    public function __construct(private readonly AuditTrail $audit) {}

    public function select(string $pageId): SocialAccount
    {
        return DB::transaction(function () use ($pageId) {
            $account = SocialAccount::query()->lockForUpdate()->first()
                ?? throw new BusinessRuleViolation('SOCIAL_NOT_CONNECTED', 'Connect Facebook first.');
            $page = null;
            foreach ($account->grantedPages() as $candidate) {
                if ($candidate->id === $pageId) {
                    $page = $candidate;
                }
            }
            if ($page === null) {
                throw ValidationException::withMessages(['page_id' => ['Choose one of the Pages you connected.']]);
            }
            $old = ['page_id' => $account->page_id, 'page_name' => $account->page_name, 'instagram_username' => $account->instagram_username];
            $account->usePage($page);
            if ($account->isDirty()) {
                $account->save();
                $this->audit->record('social.account_selected', $account, $old, [
                    'page_id' => $account->page_id, 'page_name' => $account->page_name, 'instagram_username' => $account->instagram_username,
                ]);
            }

            return $account;
        });
    }

    public function disconnect(): void
    {
        DB::transaction(function () {
            $account = SocialAccount::query()->lockForUpdate()->first();
            if ($account === null) {
                return;
            }
            $this->audit->record('social.disconnected', $account, ['page_id' => $account->page_id, 'page_name' => $account->page_name, 'sandbox' => $account->sandbox], []);
            $account->delete();
        });
    }
}
