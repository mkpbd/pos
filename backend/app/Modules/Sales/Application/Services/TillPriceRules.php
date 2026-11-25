<?php

namespace App\Modules\Sales\Application\Services;

use App\Modules\Pos\Application\Contracts\TillApprovals;
use App\Modules\Shared\Application\Contracts\TenantUser;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use App\Modules\Shared\Domain\ValueObjects\Decimal;
use Illuminate\Support\Facades\Gate;

/**
 * POS1a: who may charge what at the till, for one pricing of one cart (make a new one per
 * cart: it remembers the discount approval it checked).
 *
 * - Open-price products: the cashier types the price (`unit_price` required → PRICE_REQUIRED).
 * - Any other product is charged its catalog price unless `unit_price` differs from it: that
 *   needs `sales.price_override`, or a manager's till approval for that variant
 *   (`price_approval_id`), else APPROVAL_REQUIRED (`action: price_override`, `line`).
 * - Manual item and invoice discounts need `sales.discount`, or a manager's till approval
 *   for discounts (`discount_approval_id`), else APPROVAL_REQUIRED (`action: discount`).
 *
 * Approvals are only checked here (APPROVAL_INVALID when unusable); checkout consumes them.
 * The Pos module provides them (TillApprovals), resolved only when a cart carries one.
 */
class TillPriceRules
{
    public const SOURCE_CATALOG = 'catalog';

    public const SOURCE_OVERRIDE = 'override';

    public const SOURCE_OPEN = 'open';

    private readonly bool $canDiscount;

    private readonly bool $canOverride;

    private readonly string $requesterId;

    /** @var array{id: string, approver_id: string, approver_name: string}|null */
    private ?array $discountApproval = null;

    private bool $discountAuthorized = false;

    /**
     * @param  ?string  $storeId  the till's store: approvals given at another store do not count
     */
    public function __construct(TenantUser $actor, private readonly ?string $discountApprovalId, private readonly ?string $storeId = null)
    {
        $gate = Gate::forUser($actor);
        $this->canDiscount = $gate->allows('sales.discount');
        $this->canOverride = $gate->allows('sales.price_override');
        $this->requesterId = (string) $actor->getAuthIdentifier();
    }

    /**
     * The price a line is charged and where it comes from.
     *
     * @param  array<string, mixed>  $line  the cart line (`unit_price`, `price_approval_id`)
     * @param  array<string, mixed>  $variant  ProductDirectory variant
     * @return array{unit_price: string, list_price: ?string, source: string, approval: ?array{id: string, approver_id: string, approver_name: string}}
     *
     * @throws BusinessRuleViolation PRICE_REQUIRED, APPROVAL_REQUIRED, APPROVAL_INVALID
     */
    public function linePrice(int $index, array $line, array $variant): array
    {
        $typed = isset($line['unit_price']) && $line['unit_price'] !== '' ? Decimal::round((string) $line['unit_price'], 2) : null;
        if ($typed !== null && Decimal::compare($typed, '0') <= 0) {
            throw new BusinessRuleViolation('PRICE_REQUIRED', 'Enter a price greater than zero.', ['line' => $index]);
        }

        if ($variant['open_price'] ?? false) {
            if ($typed === null) {
                throw new BusinessRuleViolation('PRICE_REQUIRED', "Enter the price of {$variant['product_name']}.", ['line' => $index]);
            }

            return ['unit_price' => $typed, 'list_price' => null, 'source' => self::SOURCE_OPEN, 'approval' => null];
        }

        $catalog = Decimal::round((string) $variant['selling_price'], 2);
        if ($typed === null || Decimal::compare($typed, $catalog) === 0) {
            return ['unit_price' => $catalog, 'list_price' => $catalog, 'source' => self::SOURCE_CATALOG, 'approval' => null];
        }

        $approval = null;
        if (! $this->canOverride) {
            $approvalId = $line['price_approval_id'] ?? null;
            if (blank($approvalId)) {
                throw new BusinessRuleViolation('APPROVAL_REQUIRED', "A manager must approve the new price of {$variant['product_name']}.", [
                    'action' => 'price_override',
                    'line' => $index,
                ]);
            }
            $approval = $this->approvals()->check((string) $approvalId, $this->requesterId, TillApprovals::PRICE_OVERRIDE, $this->scoped(['variant_id' => $variant['variant_id']]));
        }

        return ['unit_price' => $typed, 'list_price' => $catalog, 'source' => self::SOURCE_OVERRIDE, 'approval' => $approval];
    }

    /**
     * Allows a manual discount (call only when one is given): with `sales.discount`, else
     * with the cart's discount approval (checked once per cart).
     *
     * @param  array<string, mixed>  $where  `line` index, or `field: invoice_discount`
     *
     * @throws BusinessRuleViolation APPROVAL_REQUIRED, APPROVAL_INVALID
     */
    public function authorizeDiscount(array $where): void
    {
        if ($this->canDiscount || $this->discountAuthorized) {
            return;
        }
        if (blank($this->discountApprovalId)) {
            throw new BusinessRuleViolation('APPROVAL_REQUIRED', 'A manager must approve this discount.', ['action' => 'discount'] + $where);
        }

        $this->discountApproval = $this->approvals()->check((string) $this->discountApprovalId, $this->requesterId, TillApprovals::DISCOUNT, $this->scoped([]));
        $this->discountAuthorized = true;
    }

    /**
     * The discount approval the cart's manual discounts used (null when none was needed).
     *
     * @return array{id: string, approver_id: string, approver_name: string}|null
     */
    public function discountApproval(): ?array
    {
        return $this->discountApproval;
    }

    /**
     * @param  array<string, mixed>  $details
     * @return array<string, mixed>
     */
    private function scoped(array $details): array
    {
        return $this->storeId === null ? $details : $details + ['store_id' => $this->storeId];
    }

    private function approvals(): TillApprovals
    {
        return app(TillApprovals::class);
    }
}
