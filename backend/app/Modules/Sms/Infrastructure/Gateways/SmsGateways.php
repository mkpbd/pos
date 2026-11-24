<?php

namespace App\Modules\Sms\Infrastructure\Gateways;

use App\Modules\Sms\Application\Contracts\SmsGateway;
use Illuminate\Contracts\Container\Container;

/**
 * BD1a: the gateway of a driver (`log` or `http`).
 */
final class SmsGateways
{
    public function __construct(private readonly Container $container) {}

    public function for(string $driver): SmsGateway
    {
        return $driver === HttpSmsGateway::DRIVER
            ? $this->container->make(HttpSmsGateway::class)
            : $this->container->make(LogSmsGateway::class);
    }
}
