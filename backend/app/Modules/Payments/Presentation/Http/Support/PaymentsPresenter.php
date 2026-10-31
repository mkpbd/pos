<?php

namespace App\Modules\Payments\Presentation\Http\Support;

use App\Modules\Branches\Application\Contracts\BranchDirectory;
use App\Modules\Payments\Application\Services\DrawerCash;
use App\Modules\Payments\Domain\PaymentDirection;
use App\Modules\Payments\Domain\PaymentMethod;
use App\Modules\Payments\Domain\SessionStatus;
use App\Modules\Payments\Infrastructure\Models\CashRegister;
use App\Modules\Payments\Infrastructure\Models\Payment;
use App\Modules\Payments\Infrastructure\Models\RegisterSession;
use App\Modules\Shared\Application\Contracts\TenantUser;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Shared\Domain\ValueObjects\Decimal;
use App\Modules\Users\Application\Contracts\UserDirectory;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Gate;
use Symfony\Component\HttpKernel\Exception\AccessDeniedHttpException;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

/**
 * Shapes registers, sessions and ledger rows for the API, and decides which sessions a user
 * may see: every session of their branches with `cash_registers.view`, otherwise their own.
 */
class PaymentsPresenter
{
    public const SOURCE_LABELS = [
        'sale' => 'Sales',
        'sale_cancellation' => 'Sale cancellations',
        'sale_return' => 'Refunds',
        'customer_payment' => 'Customer payments',
        'expense' => 'Expenses',
        'income' => 'Other income',
        'expense_void' => 'Voided expenses',
        'income_void' => 'Voided income',
        'cash_in' => 'Cash in',
        'cash_out' => 'Cash out',
        'online_order' => 'Online orders',
        'online_order_refund' => 'Online order refunds',
    ];

    public function __construct(
        private readonly TenantContext $tenant,
        private readonly BranchDirectory $branches,
        private readonly UserDirectory $users,
        private readonly DrawerCash $drawer,
    ) {}

    /**
     * @param  Builder<RegisterSession>  $query
     */
    public function scopeVisibleSessions(Builder $query, TenantUser $user): void
    {
        if (Gate::forUser($user)->allows('cash_registers.view')) {
            $accessible = $user->accessibleBranchIds();
            if ($accessible !== null) {
                $query->whereIn('branch_id', $accessible);
            }

            return;
        }
        if (Gate::forUser($user)->allows('cash_registers.operate')) {
            $query->where('opened_by', $user->getAuthIdentifier());

            return;
        }

        throw new AccessDeniedHttpException;
    }

    public function assertSessionVisible(TenantUser $user, RegisterSession $session): void
    {
        $visible = Gate::forUser($user)->allows('cash_registers.view')
            ? $user->canAccessBranch($session->branch_id)
            : Gate::forUser($user)->allows('cash_registers.operate') && $session->opened_by === $user->getAuthIdentifier();

        if (! $visible) {
            throw new NotFoundHttpException;
        }
    }

    /**
     * @param  Collection<int, CashRegister>  $registers
     * @return list<array<string, mixed>>
     */
    public function registers(Collection $registers): array
    {
        $org = $this->tenant->requireOrganization();
        $open = RegisterSession::query()
            ->whereIn('cash_register_id', $registers->pluck('id'))
            ->where('status', SessionStatus::Open)
            ->get()
            ->keyBy('cash_register_id');
        $branches = collect($this->branches->summaries($org, $registers->pluck('branch_id')->unique()->values()->all()))->keyBy('id');
        $users = $this->users->names($org, $open->pluck('opened_by')->unique()->values()->all());

        return $registers->map(fn (CashRegister $r) => [
            'id' => $r->id,
            'code' => $r->code,
            'name' => $r->name,
            'is_active' => $r->is_active,
            'branch' => isset($branches[$r->branch_id]) ? ['id' => $r->branch_id, 'code' => $branches[$r->branch_id]['code'], 'name' => $branches[$r->branch_id]['name']] : null,
            'open_session' => ($s = $open[$r->id] ?? null) === null ? null : [
                'id' => $s->id,
                'number' => $s->number,
                'opened_at' => $s->opened_at->toIso8601String(),
                'opened_by' => ['id' => $s->opened_by, 'name' => $users[$s->opened_by] ?? null],
            ],
        ])->values()->all();
    }

    /**
     * @param  Collection<int, RegisterSession>  $sessions
     * @return callable(RegisterSession): array<string, mixed>
     */
    public function sessionHeaders(Collection $sessions): callable
    {
        $org = $this->tenant->requireOrganization();
        $registers = CashRegister::query()->whereKey($sessions->pluck('cash_register_id')->unique())->get()->keyBy('id');
        $branches = collect($this->branches->summaries($org, $sessions->pluck('branch_id')->unique()->values()->all()))->keyBy('id');
        $users = $this->users->names($org, $sessions->flatMap(fn (RegisterSession $s) => [$s->opened_by, $s->closed_by])->filter()->unique()->values()->all());

        return fn (RegisterSession $s) => [
            'id' => $s->id,
            'number' => $s->number,
            'status' => $s->status->value,
            'currency' => $s->currency,
            'branch' => isset($branches[$s->branch_id]) ? ['id' => $s->branch_id, 'code' => $branches[$s->branch_id]['code'], 'name' => $branches[$s->branch_id]['name']] : null,
            'register' => ($r = $registers[$s->cash_register_id] ?? null) === null ? null : ['id' => $r->id, 'code' => $r->code, 'name' => $r->name],
            'opening_float' => $s->opening_float,
            'opened_by' => ['id' => $s->opened_by, 'name' => $users[$s->opened_by] ?? null],
            'opened_at' => $s->opened_at->toIso8601String(),
            'expected_cash' => $s->expected_cash,
            'counted_cash' => $s->counted_cash,
            'variance' => $s->variance,
            'closing_notes' => $s->closing_notes,
            'closed_by' => $s->closed_by === null ? null : ['id' => $s->closed_by, 'name' => $users[$s->closed_by] ?? null],
            'closed_at' => $s->closed_at?->toIso8601String(),
        ];
    }

    /**
     * The session report (X report while open, Z report once closed): cash reconciliation,
     * totals per method and per kind of transaction, and the most recent entries.
     *
     * @return array<string, mixed>
     */
    public function sessionReport(RegisterSession $session): array
    {
        $rows = Payment::query()
            ->where('cash_register_session_id', $session->id)
            ->groupBy('method', 'source_type', 'direction')
            ->selectRaw('method, source_type, direction, SUM(amount) as total, COUNT(*) as entries')
            ->get();

        $byMethod = [];
        $bySource = [];
        foreach ($rows as $row) {
            $amount = Decimal::round((string) $row->getAttribute('total'), 2);
            $dir = $row->direction === PaymentDirection::In ? 'in' : 'out';
            $method = $row->method->value;
            $byMethod[$method] ??= ['method' => $method, 'label' => $row->method->label(), 'in' => '0.00', 'out' => '0.00'];
            $byMethod[$method][$dir] = Decimal::add($byMethod[$method][$dir], $amount, 2);
            $type = (string) $row->getAttribute('source_type');
            $bySource[$type] ??= ['source_type' => $type, 'label' => self::SOURCE_LABELS[$type] ?? ucfirst(str_replace('_', ' ', $type)), 'in' => '0.00', 'out' => '0.00', 'entries' => 0];
            $bySource[$type][$dir] = Decimal::add($bySource[$type][$dir], $amount, 2);
            $bySource[$type]['entries'] += (int) $row->getAttribute('entries');
        }
        $byMethod = array_map(fn (array $m) => $m + ['net' => Decimal::sub($m['in'], $m['out'], 2)], array_values($byMethod));

        $cash = collect($byMethod)->firstWhere('method', PaymentMethod::Cash->value) ?? ['in' => '0.00', 'out' => '0.00'];
        $expected = $session->status === SessionStatus::Closed ? $session->expected_cash : $this->drawer->expected($session);

        $entries = Payment::query()->where('cash_register_session_id', $session->id)->latest('created_at')->limit(200)->get();

        return ($this->sessionHeaders(collect([$session])))($session) + [
            'cash' => [
                'opening_float' => $session->opening_float,
                'cash_in' => $cash['in'],
                'cash_out' => $cash['out'],
                'expected' => $expected,
                'counted' => $session->counted_cash,
                'variance' => $session->variance,
            ],
            'by_method' => $byMethod,
            'by_source' => array_values($bySource),
            'entries' => $entries->map($this->payments($entries))->all(),
        ];
    }

    /**
     * @param  Collection<int, Payment>  $payments
     * @return callable(Payment): array<string, mixed>
     */
    public function payments(Collection $payments): callable
    {
        $org = $this->tenant->requireOrganization();
        $users = $this->users->names($org, $payments->pluck('created_by')->filter()->unique()->values()->all());
        $sessions = RegisterSession::query()->whereKey($payments->pluck('cash_register_session_id')->filter()->unique())->pluck('number', 'id');

        return fn (Payment $p) => [
            'id' => $p->id,
            'branch_id' => $p->branch_id,
            'direction' => $p->direction->value,
            'method' => $p->method->value,
            'method_label' => $p->method->label(),
            'currency' => $p->currency,
            'amount' => $p->amount,
            'source_type' => $p->source_type,
            'source_label' => self::SOURCE_LABELS[$p->source_type] ?? ucfirst(str_replace('_', ' ', $p->source_type)),
            'source_id' => $p->source_id,
            'source_number' => $p->source_number,
            'customer_id' => $p->customer_id,
            'reference' => $p->reference,
            'description' => $p->description,
            'session' => $p->cash_register_session_id === null ? null : ['id' => $p->cash_register_session_id, 'number' => $sessions[$p->cash_register_session_id] ?? null],
            'created_by' => $p->created_by === null ? null : ['id' => $p->created_by, 'name' => $users[$p->created_by] ?? null],
            'created_at' => $p->created_at->toIso8601String(),
        ];
    }
}
