<?php

namespace App\Modules\CustomerAccounts\Application\Actions;

use App\Modules\CustomerAccounts\Domain\AccountStatus;
use App\Modules\CustomerAccounts\Infrastructure\Models\CustomerAccount;
use App\Modules\Shared\Application\Contracts\AuditTrail;
use Illuminate\Support\Facades\DB;

/**
 * Staff enable or disable a customer's online sign-in. A disabled account is refused at
 * sign-in and on every signed-in request (customer.active), so open sessions end at once.
 */
class ChangeAccountStatus
{
    public function __construct(private readonly AuditTrail $audit) {}

    public function __invoke(string $customerId, AccountStatus $status): CustomerAccount
    {
        return DB::transaction(function () use ($customerId, $status) {
            /** @var CustomerAccount $account */
            $account = CustomerAccount::query()->where('customer_id', $customerId)->lockForUpdate()->firstOrFail();
            $before = $account->status;

            if ($before !== $status) {
                $account->forceFill(['status' => $status])->save();
                $this->audit->record('customer_account.status_changed', $account, ['status' => $before->value], ['status' => $status->value], ['customer_id' => $customerId]);
            }

            return $account;
        });
    }
}
