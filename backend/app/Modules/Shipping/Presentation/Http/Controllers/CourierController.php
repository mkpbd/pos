<?php

namespace App\Modules\Shipping\Presentation\Http\Controllers;

use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use App\Modules\Shared\Infrastructure\Validation\TenantUnique;
use App\Modules\Shipping\Application\Actions\ManageCouriers;
use App\Modules\Shipping\Domain\TrackingUrl;
use App\Modules\Shipping\Infrastructure\Models\Courier;
use Closure;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Couriers (E10a). Reading needs `shipping.manage` or `web_orders.view`; changes need
 * `shipping.manage`.
 */
class CourierController
{
    /**
     * Couriers
     *
     * Every courier in display order (sort_order, name): `[{id, name, phone,
     * tracking_url_template, is_active, sort_order}]`. `?active=1` lists active ones only.
     */
    public function index(Request $request): JsonResponse
    {
        if (! $request->user()->canAny(['shipping.manage', 'web_orders.view'])) {
            throw new AuthorizationException;
        }
        $request->validate(['active' => ['sometimes', 'boolean']]);

        return ApiResponse::success(Courier::query()
            ->when($request->boolean('active'), fn ($q) => $q->where('is_active', true))
            ->orderBy('sort_order')->orderBy('name')->get()
            ->map(fn (Courier $c) => self::present($c))->values()->all());
    }

    /**
     * Add a courier
     *
     * `{name (≤ 80, unique), phone?, tracking_url_template? (http(s) URL containing
     * {tracking}), is_active?, sort_order?}`.
     */
    public function store(Request $request, ManageCouriers $couriers): JsonResponse
    {
        return ApiResponse::created(self::present($couriers->create($this->data($request, null))));
    }

    /**
     * Change a courier
     *
     * Any subset of the fields.
     */
    public function update(Request $request, Courier $courier, ManageCouriers $couriers): JsonResponse
    {
        return ApiResponse::success(self::present($couriers->update($courier, $this->data($request, $courier))));
    }

    /**
     * Delete a courier
     *
     * Only couriers that never carried a shipment nor sent a remittance (422 `IN_USE`;
     * deactivate those instead).
     */
    public function destroy(Courier $courier, ManageCouriers $couriers): JsonResponse
    {
        $couriers->delete($courier);

        return ApiResponse::noContent();
    }

    /**
     * @return array<string, mixed>
     */
    public static function present(Courier $c): array
    {
        return [
            'id' => $c->id,
            'name' => $c->name,
            'phone' => $c->phone,
            'tracking_url_template' => $c->tracking_url_template,
            'is_active' => $c->is_active,
            'sort_order' => $c->sort_order,
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function data(Request $request, ?Courier $courier): array
    {
        $required = $courier === null ? 'required' : 'sometimes';
        $data = $request->validate([
            'name' => [$required, 'string', 'max:80', 'regex:/\S/', new TenantUnique('couriers', 'name', $courier?->id)],
            'phone' => ['sometimes', 'nullable', 'string', 'max:20'],
            'tracking_url_template' => ['sometimes', 'nullable', 'string', 'max:500', function (string $attribute, mixed $value, Closure $fail) {
                if (is_string($value) && trim($value) !== '' && ! TrackingUrl::isValidTemplate(trim($value))) {
                    $fail('The tracking link must be an http(s) URL containing {tracking}.');
                }
            }],
            'is_active' => ['sometimes', 'boolean'],
            'sort_order' => ['sometimes', 'integer', 'min:0', 'max:9999'],
        ]);
        if (array_key_exists('is_active', $data)) {
            $data['is_active'] = $request->boolean('is_active');
        }

        return $data;
    }
}
