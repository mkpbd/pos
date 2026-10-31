<?php

namespace App\Modules\Users\Application\DTOs;

use App\Modules\Users\Domain\Enums\UserStatus;

final readonly class UserData
{
    /**
     * @param  list<string>  $roleIds
     * @param  list<string>  $branchIds
     */
    public function __construct(
        public string $name,
        public string $email,
        public string $password,
        public array $roleIds,
        public array $branchIds,
        public ?string $phone = null,
        public UserStatus $status = UserStatus::Active,
    ) {}

    /**
     * @param  array<string, mixed>  $data  validated request data
     */
    public static function fromArray(array $data): self
    {
        return new self(
            name: $data['name'],
            email: mb_strtolower($data['email']),
            password: $data['password'],
            roleIds: array_values($data['role_ids'] ?? []),
            branchIds: array_values($data['branch_ids'] ?? []),
            phone: $data['phone'] ?? null,
            status: isset($data['status']) ? UserStatus::from($data['status']) : UserStatus::Active,
        );
    }
}
