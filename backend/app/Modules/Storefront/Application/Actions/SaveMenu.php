<?php

namespace App\Modules\Storefront\Application\Actions;

use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Shared\Application\Support\Changes;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use App\Modules\Shared\Infrastructure\Persistence\ReferentialIntegrity;
use App\Modules\Storefront\Infrastructure\Models\Menu;
use Illuminate\Support\Facades\DB;

class SaveMenu
{
    public function __construct(private readonly AuditTrail $audit) {}

    /**
     * @param  array{name?: string, location?: string, is_active?: bool}  $attributes
     */
    public function save(Menu $menu, array $attributes): Menu
    {
        return DB::transaction(function () use ($menu, $attributes) {
            $creating = ! $menu->exists;
            $before = $creating ? [] : $this->snapshot($menu);

            $menu->fill($attributes);
            if (! $creating && $menu->isDirty('location') && ! $menu->location->allowsMega() && $menu->items()->where('is_mega', true)->exists()) {
                throw new BusinessRuleViolation('MEGA_MENU_NOT_ALLOWED', 'Only the main navigation can have mega menu items. Turn them off first.');
            }
            $menu->save();

            [$old, $new] = Changes::between($before, $this->snapshot($menu));
            if ($creating || $new !== []) {
                $this->audit->record($creating ? 'menu.created' : 'menu.updated', $menu, $old, $new);
            }

            return $menu;
        });
    }

    public function delete(Menu $menu): void
    {
        DB::transaction(function () use ($menu) {
            ReferentialIntegrity::deleteOrFail($menu, 'menu');
            $this->audit->record('menu.deleted', $menu, $this->snapshot($menu));
        });
    }

    /**
     * @return array<string, mixed>
     */
    private function snapshot(Menu $menu): array
    {
        return ['name' => $menu->name, 'location' => $menu->location->value, 'is_active' => $menu->is_active];
    }
}
