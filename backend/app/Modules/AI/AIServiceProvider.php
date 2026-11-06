<?php

namespace App\Modules\AI;

use App\Modules\AI\Application\Services\AiGate;
use App\Modules\AI\Domain\Contracts\LanguageModel;
use App\Modules\AI\Infrastructure\Console\GenerateDailyInsightsCommand;
use App\Modules\AI\Infrastructure\Providers\AnthropicLanguageModel;
use App\Modules\AI\Infrastructure\Providers\FakeLanguageModel;
use App\Modules\AI\Infrastructure\Providers\NullLanguageModel;
use App\Modules\Shared\Application\Contracts\AiFeatures;
use App\Modules\Shared\Infrastructure\Providers\ModuleServiceProvider;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Contracts\Foundation\Application;
use Illuminate\Http\Client\Factory as HttpFactory;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;

/**
 * Optional AI module (Phase 8, docs/AI_INTEGRATION.md): provider abstraction, the read-only tool
 * layer over the report registry, Ask AI, business insights, customer insights (RFM) and the
 * reorder explanation. Off unless AI_ENABLED; without a configured provider NullLanguageModel is
 * bound and every model call is 503 AI_UNAVAILABLE.
 */
class AIServiceProvider extends ModuleServiceProvider
{
    public function register(): void
    {
        $this->app->bind(LanguageModel::class, fn (Application $app) => self::model($app));
        $this->app->bind(AiFeatures::class, AiGate::class);
    }

    public function boot(): void
    {
        parent::boot();

        RateLimiter::for('ai', fn (Request $request) => Limit::perMinute(max(1, (int) config('ai.ask_rate_limit', 20)))
            ->by('ai|'.($request->user()?->getAuthIdentifier() ?: $request->ip())));

        if ($this->app->runningInConsole()) {
            $this->commands([GenerateDailyInsightsCommand::class]);
        }
    }

    private static function model(Application $app): LanguageModel
    {
        if (! config('ai.enabled')) {
            return new NullLanguageModel('disabled');
        }

        return match ((string) config('ai.provider')) {
            AnthropicLanguageModel::PROVIDER => is_string($key = config('ai.api_key')) && $key !== ''
                ? new AnthropicLanguageModel(
                    $app->make(HttpFactory::class),
                    $key,
                    (string) config('ai.model', 'claude-sonnet-5-5'),
                    max(1, (int) config('ai.timeout', 30)),
                    [
                        'base_url' => (string) config('ai.anthropic.base_url', 'https://api.anthropic.com'),
                        'version' => (string) config('ai.anthropic.version', '2026-10-21'),
                        'max_tokens' => max(256, (int) config('ai.anthropic.max_tokens', 8000)),
                        'effort' => config('ai.anthropic.effort'),
                        'refusal_fallback' => (bool) config('ai.anthropic.refusal_fallback', true),
                        'max_retries' => max(0, (int) config('ai.anthropic.max_retries', 2)),
                        'retry_base_ms' => max(0, (int) config('ai.anthropic.retry_base_ms', 500)),
                        'retry_max_ms' => max(0, (int) config('ai.anthropic.retry_max_ms', 8000)),
                    ],
                )
                : new NullLanguageModel('not_configured'),
            // Scripted answers for local demos; never in production.
            'fake' => $app->isProduction() ? new NullLanguageModel('not_configured') : new FakeLanguageModel,
            default => new NullLanguageModel('not_configured'),
        };
    }

    protected function permissions(): array
    {
        return [
            'ai.ask' => 'Ask the AI assistant questions answered from the reports you may run (natural-language reporting, sales and inventory assistant, reorder explanations)',
            'ai.insights' => 'View AI business insights and customer (RFM) insights for accessible branches',
            'ai.manage' => 'Manage AI settings for the organization (enable, monthly token budget) and view AI usage',
        ];
    }
}
