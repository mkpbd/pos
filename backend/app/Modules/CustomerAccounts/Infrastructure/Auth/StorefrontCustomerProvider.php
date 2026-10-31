<?php

namespace App\Modules\CustomerAccounts\Infrastructure\Auth;

use App\Modules\Shared\Application\Tenancy\TenantContext;
use Illuminate\Auth\EloquentUserProvider;
use Illuminate\Contracts\Auth\Authenticatable;

/**
 * User provider of the `customer` guard. Accounts are looked up only while a storefront
 * has put its organization in the tenant context (the model's organization scope then
 * filters by it): a session cookie of store A is anonymous on store B's host, and without
 * an organization in context nobody is a customer. `auth:customer` routes therefore run
 * after the `storefront` middleware (middleware priority).
 */
class StorefrontCustomerProvider extends EloquentUserProvider
{
    public function retrieveById($identifier): ?Authenticatable
    {
        return $this->inStorefront() ? parent::retrieveById($identifier) : null;
    }

    public function retrieveByToken($identifier, #[\SensitiveParameter] $token): ?Authenticatable
    {
        return $this->inStorefront() ? parent::retrieveByToken($identifier, $token) : null;
    }

    public function retrieveByCredentials(#[\SensitiveParameter] array $credentials): ?Authenticatable
    {
        return $this->inStorefront() ? parent::retrieveByCredentials($credentials) : null;
    }

    private function inStorefront(): bool
    {
        return app(TenantContext::class)->hasOrganization();
    }
}
