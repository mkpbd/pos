<?php

namespace App\Modules\Imports\Application\Support;

use App\Modules\Imports\Application\Contracts\ImportHandler;
use Illuminate\Contracts\Auth\Access\Authorizable;
use Illuminate\Contracts\Container\Container;
use Illuminate\Support\Facades\Gate;

/**
 * The import types, collected from the handlers other modules tag with ImportHandler::TAG.
 */
final class ImportHandlerRegistry
{
    /** @var array<string, ImportHandler>|null */
    private ?array $handlers = null;

    public function __construct(private readonly Container $container) {}

    /**
     * @return array<string, ImportHandler> type => handler, in registration order
     */
    public function all(): array
    {
        if ($this->handlers === null) {
            $this->handlers = [];
            foreach ($this->container->tagged(ImportHandler::TAG) as $handler) {
                /** @var ImportHandler $handler */
                $this->handlers[$handler->type()] = $handler;
            }
        }

        return $this->handlers;
    }

    public function find(string $type): ?ImportHandler
    {
        return $this->all()[$type] ?? null;
    }

    /**
     * @return list<string>
     */
    public function typesAllowedFor(Authorizable $user): array
    {
        return array_values(array_map(
            fn (ImportHandler $h) => $h->type(),
            array_filter($this->all(), fn (ImportHandler $h) => Gate::forUser($user)->allows($h->permission())),
        ));
    }
}
