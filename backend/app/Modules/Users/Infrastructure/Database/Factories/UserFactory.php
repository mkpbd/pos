<?php

namespace App\Modules\Users\Infrastructure\Database\Factories;

use App\Modules\Organizations\Infrastructure\Models\Organization;
use App\Modules\Users\Infrastructure\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;

/**
 * @extends Factory<User>
 */
class UserFactory extends Factory
{
    protected $model = User::class;

    protected static ?string $password = null;

    public function definition(): array
    {
        return [
            'organization_id' => Organization::factory(),
            'name' => fake()->name(),
            'email' => fake()->unique()->safeEmail(),
            'email_verified_at' => now(),
            'password' => static::$password ??= Hash::make('password'),
            'status' => 'active',
            'remember_token' => Str::random(10),
        ];
    }

    public function platformAdmin(): static
    {
        return $this->state(['organization_id' => null])
            ->afterMaking(fn (User $user) => $user->is_platform_admin = true);
    }

    public function inactive(): static
    {
        return $this->state(['status' => 'inactive']);
    }
}
