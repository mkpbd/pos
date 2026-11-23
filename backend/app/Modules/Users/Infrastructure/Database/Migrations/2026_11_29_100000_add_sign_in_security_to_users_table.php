<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * G1a: two-factor sign-in (authenticator app + recovery codes) and account lockout.
 * The secret and the recovery-code hashes are stored encrypted (Eloquent `encrypted` casts).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->text('two_factor_secret')->nullable();
            // Two-factor sign-in is on only once the first code was confirmed.
            $table->timestampTz('two_factor_confirmed_at')->nullable();
            $table->text('two_factor_recovery_codes')->nullable();
            // Last accepted TOTP time step: a code is never accepted twice.
            $table->bigInteger('two_factor_last_step')->nullable();
            $table->integer('failed_login_count')->default(0);
            $table->timestampTz('locked_until')->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn([
                'two_factor_secret', 'two_factor_confirmed_at', 'two_factor_recovery_codes',
                'two_factor_last_step', 'failed_login_count', 'locked_until',
            ]);
        });
    }
};
