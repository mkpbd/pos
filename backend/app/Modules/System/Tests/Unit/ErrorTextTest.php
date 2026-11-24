<?php

namespace App\Modules\System\Tests\Unit;

use App\Modules\System\Domain\ErrorLog\ErrorText;
use App\Modules\System\Domain\Status\HealthRules;
use DateTimeImmutable;
use PHPUnit\Framework\TestCase;

class ErrorTextTest extends TestCase
{
    public function test_sanitise_redacts_secrets_and_personal_data(): void
    {
        $this->assertSame('Login failed: password=[redacted] for [email]', ErrorText::sanitise('Login failed: password=hunter2 for jane.doe@example.com'));
        $this->assertSame('api_key: [redacted], other', ErrorText::sanitise('api_key: "abc def", other'));
        $this->assertSame('GET /x?token=[redacted]&page=2', ErrorText::sanitise('GET /x?token=abc123&page=2'));
        $this->assertSame('DB_PASSWORD=[redacted] client_secret=[redacted]', ErrorText::sanitise('DB_PASSWORD=example-only client_secret=s3cr3t'));
        $this->assertSame('connect postgresql://[redacted]@db:5432/pos', ErrorText::sanitise('connect postgresql://pos_app:p4ss@db:5432/pos'));
        $this->assertSame('Card [number] declined, order 12345', ErrorText::sanitise('Card 4111111111111111 declined, order 12345'));
    }

    public function test_sanitise_truncates(): void
    {
        $text = ErrorText::sanitise(str_repeat('a', 1500));

        $this->assertSame(ErrorText::MESSAGE_LIMIT, mb_strlen($text));
        $this->assertStringEndsWith('…', $text);
    }

    public function test_normalise_groups_variable_parts(): void
    {
        $this->assertSame(
            ErrorText::normalise('Order 12 of 019a5f7e-1c2d-7e3f-8a9b-0c1d2e3f4a5b failed for "Jane" <a@b.co>'),
            ErrorText::normalise('Order 13 of 019a5f7e-ffff-7e3f-8a9b-0c1d2e3f4a5b failed for "John" <c@d.co>'),
        );
        $this->assertSame('Order {number} failed', ErrorText::normalise('Order 12 failed'));
        $this->assertNotSame(ErrorText::fingerprint('A', 'f.php', 1, 'x'), ErrorText::fingerprint('A', 'f.php', 2, 'x'));
        $this->assertSame(ErrorText::fingerprint('A', 'f.php', 1, 'Item 5'), ErrorText::fingerprint('A', 'f.php', 1, 'Item 6'));
    }

    public function test_first_line(): void
    {
        $this->assertSame('RuntimeException: boom', ErrorText::firstLine("\n  RuntimeException: boom\n#0 trace", 100));
    }

    public function test_health_rules(): void
    {
        $now = new DateTimeImmutable('2026-11-24 10:00:00');

        $this->assertSame('unknown', HealthRules::scheduler(null, $now));
        $this->assertSame('ok', HealthRules::scheduler($now->modify('-3 minutes'), $now));
        $this->assertSame('stale', HealthRules::scheduler($now->modify('-181 seconds'), $now));

        $this->assertSame('sync', HealthRules::queue('sync', null, $now));
        $this->assertSame('unknown', HealthRules::queue('redis', null, $now));
        $this->assertSame('ok', HealthRules::queue('database', $now->modify('-5 minutes'), $now));
        $this->assertSame('stale', HealthRules::queue('database', $now->modify('-301 seconds'), $now));

        $this->assertTrue(HealthRules::backupIsStale(null, $now));
        $this->assertFalse(HealthRules::backupIsStale($now->modify('-26 hours'), $now));
        $this->assertTrue(HealthRules::backupIsStale($now->modify('-26 hours -1 second'), $now));
        $this->assertTrue(HealthRules::verificationIsStale($now->modify('-9 days'), $now));
        $this->assertFalse(HealthRules::verificationIsStale($now->modify('-7 days'), $now));

        $this->assertTrue(HealthRules::diskIsLow(9.0, 100.0));
        $this->assertFalse(HealthRules::diskIsLow(10.0, 100.0));
        $this->assertFalse(HealthRules::diskIsLow(null, 100.0));
    }
}
