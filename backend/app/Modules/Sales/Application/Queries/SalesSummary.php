<?php

namespace App\Modules\Sales\Application\Queries;

use App\Modules\Sales\Application\Services\SalesContext;
use App\Modules\Sales\Domain\PaymentMethod;
use App\Modules\Sales\Domain\SaleStatus;
use App\Modules\Sales\Infrastructure\Models\Sale;
use App\Modules\Sales\Infrastructure\Models\SalePayment;
use App\Modules\Shared\Application\Contracts\TenantUser;
use App\Modules\Shared\Domain\ValueObjects\Decimal;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Carbon;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

/**
 * Daily sales summary for the branches the user can access (or one branch): what was sold
 * on the organization's calendar day, what it cost, and the money taken per payment method
 * (net of reversals made that day).
 */
class SalesSummary
{
    public function __construct(private readonly SalesContext $context) {}

    /**
     * @return array<string, mixed>
     */
    public function __invoke(TenantUser $user, string $date, ?string $branchId = null): array
    {
        if ($branchId !== null && ! $user->canAccessBranch($branchId)) {
            throw new NotFoundHttpException;
        }

        $timezone = $this->context->organization()['timezone'] ?? config('app.timezone');
        $from = Carbon::parse($date, $timezone)->startOfDay()->setTimezone(config('app.timezone'));
        $to = $from->copy()->addDay();
        $accessible = $user->accessibleBranchIds();
        $scope = fn (Builder $q) => $q
            ->when($branchId, fn (Builder $b) => $b->where('branch_id', $branchId))
            ->when($branchId === null && $accessible !== null, fn (Builder $b) => $b->whereIn('branch_id', $accessible));

        $sold = Sale::query()->tap($scope)
            ->where('status', SaleStatus::Completed)
            ->where('sold_at', '>=', $from)->where('sold_at', '<', $to)
            ->toBase()
            ->selectRaw('COUNT(*) as sales_count, SUM(subtotal) as subtotal, SUM(item_discount_total + invoice_discount_total) as discounts,
                SUM(tax_total) as tax, SUM(total) as total, SUM(cost_total) as cost, SUM(paid_total) as paid, SUM(due_total) as due')
            ->first();

        $cancelled = Sale::query()->tap($scope)
            ->where('status', SaleStatus::Cancelled)
            ->where('cancelled_at', '>=', $from)->where('cancelled_at', '<', $to)
            ->toBase()
            ->selectRaw('COUNT(*) as count, SUM(total) as total')
            ->first();

        $byMethod = SalePayment::query()->tap($scope)
            ->where('created_at', '>=', $from)->where('created_at', '<', $to)
            ->groupBy('method')
            ->selectRaw('method, SUM(amount) as amount')
            ->pluck('amount', 'method');

        $money = fn ($value) => Decimal::round((string) ($value ?? '0'), 2);
        $count = (int) $sold->sales_count;
        $total = $money($sold->total);
        $netSales = Decimal::sub($total, $money($sold->tax), 2);

        return [
            'date' => $from->copy()->setTimezone($timezone)->toDateString(),
            'timezone' => $timezone,
            'branch_id' => $branchId,
            'currency' => $this->context->currency(),
            'sales_count' => $count,
            'gross_sales' => $money($sold->subtotal),
            'discounts' => $money($sold->discounts),
            'net_sales' => $netSales,
            'tax' => $money($sold->tax),
            'total' => $total,
            'average_sale' => $count > 0 ? Decimal::div($total, (string) $count, 2) : '0.00',
            'cost' => $money($sold->cost),
            'gross_profit' => Decimal::sub($netSales, $money($sold->cost), 2),
            'paid' => $money($sold->paid),
            'due' => $money($sold->due),
            'cancelled_count' => (int) $cancelled->count,
            'cancelled_total' => $money($cancelled->total),
            'payments' => array_map(fn (PaymentMethod $m) => [
                'method' => $m->value,
                'label' => $m->label(),
                'amount' => $money($byMethod[$m->value] ?? null),
            ], PaymentMethod::cases()),
        ];
    }
}
