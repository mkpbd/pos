<?php

namespace App\Modules\Social\Infrastructure\Meta;

use App\Modules\Social\Domain\Meta\MetaGraphClient;
use App\Modules\Social\Domain\Meta\MetaGraphClients;
use App\Modules\Social\Domain\SocialMode;
use Illuminate\Contracts\Container\Container;

/**
 * P2b: resolves the sandbox or the live client (a fresh one per use, so faked HTTP clients apply).
 */
final class ContainerMetaGraphClients implements MetaGraphClients
{
    public function __construct(private readonly Container $container) {}

    public function for(SocialMode $mode): MetaGraphClient
    {
        return $mode === SocialMode::Live
            ? $this->container->make(HttpMetaGraphClient::class, ['timeout' => max(1, (int) config('social.meta.timeout', 30))])
            : $this->container->make(SandboxMetaGraphClient::class);
    }
}
