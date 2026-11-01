<?php

namespace App\Modules\Shipping\Infrastructure;

use App\Modules\Shipping\Application\Contracts\CourierDirectory;
use App\Modules\Shipping\Domain\TrackingUrl;
use App\Modules\Shipping\Infrastructure\Models\Courier;

class EloquentCourierDirectory implements CourierDirectory
{
    public function find(string $courierId): ?array
    {
        return $this->summaries([$courierId])[$courierId] ?? null;
    }

    public function summaries(array $courierIds): array
    {
        $ids = array_values(array_unique(array_filter($courierIds, fn ($id) => is_string($id) && preg_match('/^[0-9a-f-]{36}$/i', $id) === 1)));
        if ($ids === []) {
            return [];
        }

        return Courier::query()->whereKey($ids)->get()
            ->mapWithKeys(fn (Courier $c) => [$c->id => [
                'id' => $c->id,
                'name' => $c->name,
                'phone' => $c->phone,
                'tracking_url_template' => $c->tracking_url_template,
                'is_active' => $c->is_active,
            ]])->all();
    }

    public function trackingUrl(?string $template, ?string $trackingNumber): ?string
    {
        return TrackingUrl::build($template, $trackingNumber);
    }
}
