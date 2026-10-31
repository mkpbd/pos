<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Global reference data (no organization_id): the divisions and districts of Bangladesh,
 * loaded from the bundled data file. Upazilas/thanas are not modelled yet; addresses keep
 * a free-text area.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('geo_divisions', function (Blueprint $table) {
            $table->unsignedSmallInteger('id')->primary();
            $table->string('code', 8)->unique();
            $table->string('name_en', 60);
            $table->string('name_bn', 60);
        });

        Schema::create('geo_districts', function (Blueprint $table) {
            $table->unsignedSmallInteger('id')->primary();
            $table->unsignedSmallInteger('division_id');
            $table->foreign('division_id')->references('id')->on('geo_divisions')->restrictOnDelete();
            $table->string('code', 8)->unique();
            $table->string('name_en', 60);
            $table->string('name_bn', 60);

            $table->index('division_id');
        });

        $data = require base_path('app/Modules/Geography/Infrastructure/Data/bangladesh.php');
        foreach ($data as $division) {
            DB::table('geo_divisions')->insert([
                'id' => $division['id'],
                'code' => $division['code'],
                'name_en' => $division['name_en'],
                'name_bn' => $division['name_bn'],
            ]);
            foreach ($division['districts'] as $district) {
                DB::table('geo_districts')->insert([
                    'id' => $district['id'],
                    'division_id' => $division['id'],
                    // District geocodes repeat across divisions only in theory; prefix keeps them unique.
                    'code' => $division['code'].$district['code'],
                    'name_en' => $district['name_en'],
                    'name_bn' => $district['name_bn'],
                ]);
            }
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('geo_districts');
        Schema::dropIfExists('geo_divisions');
    }
};
