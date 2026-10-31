<?php

namespace App\Modules\Geography\Infrastructure;

use App\Modules\Geography\Application\Contracts\GeoDirectory;
use Illuminate\Support\Facades\DB;

class DatabaseGeoDirectory implements GeoDirectory
{
    public function divisions(): array
    {
        return DB::table('geo_divisions')->orderBy('name_en')->get(['id', 'name_en', 'name_bn'])
            ->map(fn (object $row) => ['id' => (int) $row->id, 'name' => $row->name_en, 'name_bn' => $row->name_bn])
            ->all();
    }

    public function districts(?int $divisionId = null): array
    {
        return DB::table('geo_districts')
            ->when($divisionId !== null, fn ($q) => $q->where('division_id', $divisionId))
            ->orderBy('name_en')
            ->get(['id', 'division_id', 'name_en', 'name_bn'])
            ->map(fn (object $row) => ['id' => (int) $row->id, 'division_id' => (int) $row->division_id, 'name' => $row->name_en, 'name_bn' => $row->name_bn])
            ->all();
    }

    public function districtInDivision(int $districtId, int $divisionId): bool
    {
        return DB::table('geo_districts')->where('id', $districtId)->where('division_id', $divisionId)->exists();
    }

    public function names(array $divisionIds, array $districtIds): array
    {
        return [
            'divisions' => $divisionIds === [] ? [] : DB::table('geo_divisions')->whereIn('id', array_values(array_unique($divisionIds)))
                ->pluck('name_en', 'id')->mapWithKeys(fn ($name, $id) => [(int) $id => $name])->all(),
            'districts' => $districtIds === [] ? [] : DB::table('geo_districts')->whereIn('id', array_values(array_unique($districtIds)))
                ->pluck('name_en', 'id')->mapWithKeys(fn ($name, $id) => [(int) $id => $name])->all(),
        ];
    }
}
