<?php

namespace App\Modules\Catalog\Application\Actions;

use App\Modules\Catalog\Infrastructure\Models\Attribute;
use App\Modules\Catalog\Infrastructure\Models\AttributeValue;
use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Shared\Application\Support\Changes;
use App\Modules\Shared\Domain\Slug;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Creates or updates an attribute with its ordered value list. Values are replaced in the
 * given order: entries with an id update that value, entries without one are added and
 * values left out are removed. A blank slug is derived from the name.
 */
class SaveAttribute
{
    public const MAX_VALUES = 100;

    public function __construct(private readonly AuditTrail $audit) {}

    /**
     * @param  array{name?: string, slug?: ?string, display?: string, is_filterable?: bool, sort_order?: int, values?: list<array{id?: ?string, value: string, swatch_hex?: ?string}>}  $data  validated
     */
    public function __invoke(?Attribute $attribute, array $data): Attribute
    {
        return DB::transaction(function () use ($attribute, $data) {
            $creating = $attribute === null;
            $attribute ??= new Attribute;
            $before = $creating ? [] : $this->snapshot($attribute);

            $values = array_key_exists('values', $data) ? array_values($data['values'] ?? []) : null;
            unset($data['values']);

            if (array_key_exists('name', $data)) {
                $data['name'] = trim($data['name']);
            }
            $slug = isset($data['slug']) ? trim((string) $data['slug']) : '';
            unset($data['slug']);
            $attribute->fill($data);
            if ($slug !== '') {
                $attribute->slug = $slug;
            } elseif ($creating || $attribute->slug === null) {
                $attribute->slug = Slug::suggest($attribute->name, fn (string $s) => Attribute::query()
                    ->whereRaw('lower(slug) = ?', [$s])->whereKeyNot($attribute->id ?? '')->exists(), 80, 'attribute');
            }
            if ($creating && ! array_key_exists('sort_order', $data)) {
                $attribute->sort_order = (int) Attribute::query()->max('sort_order') + 1;
            }
            $attribute->save();

            if ($values !== null) {
                $this->replaceValues($attribute, $values);
            }

            [$old, $new] = Changes::between($before, $this->snapshot($attribute));
            if ($creating || $new !== []) {
                $this->audit->record($creating ? 'attribute.created' : 'attribute.updated', $attribute, $old, $new);
            }

            return $attribute->load('attributeValues');
        });
    }

    public function delete(Attribute $attribute): void
    {
        DB::transaction(function () use ($attribute) {
            $snapshot = $this->snapshot($attribute);
            $attribute->delete();
            $this->audit->record('attribute.deleted', $attribute, $snapshot);
        });
    }

    /**
     * @param  list<array{id?: ?string, value: string, swatch_hex?: ?string}>  $values
     */
    private function replaceValues(Attribute $attribute, array $values): void
    {
        $existing = $attribute->attributeValues()->get()->keyBy('id');
        $keptIds = array_values(array_filter(array_column($values, 'id')));

        $errors = [];
        foreach ($values as $i => $value) {
            if (! empty($value['id']) && ! $existing->has($value['id'])) {
                $errors["values.{$i}.id"] = ['This value does not belong to the attribute.'];
            }
        }
        if ($errors !== []) {
            throw ValidationException::withMessages($errors);
        }

        AttributeValue::query()->where('attribute_id', $attribute->id)->whereNotIn('id', $keptIds)->delete();
        // Park kept values under unique placeholders first, so renames that swap values
        // never collide with the case-insensitive unique index halfway through.
        foreach ($keptIds as $id) {
            AttributeValue::query()->whereKey($id)->update(['value' => '~'.$id]);
        }

        foreach ($values as $position => $value) {
            $attributes = [
                'value' => trim($value['value']),
                'swatch_hex' => isset($value['swatch_hex']) && $value['swatch_hex'] !== '' ? strtolower($value['swatch_hex']) : null,
                'sort_order' => $position,
            ];
            if (! empty($value['id'])) {
                AttributeValue::query()->whereKey($value['id'])->update($attributes);
            } else {
                AttributeValue::query()->create($attributes + ['attribute_id' => $attribute->id]);
            }
        }
        $attribute->unsetRelation('attributeValues');
    }

    /**
     * @return array<string, mixed>
     */
    private function snapshot(Attribute $attribute): array
    {
        return [
            'name' => $attribute->name,
            'slug' => $attribute->slug,
            'display' => $attribute->display,
            'is_filterable' => $attribute->is_filterable,
            'sort_order' => $attribute->sort_order,
            'values' => $attribute->exists ? $attribute->attributeValues()->pluck('value')->all() : [],
        ];
    }
}
