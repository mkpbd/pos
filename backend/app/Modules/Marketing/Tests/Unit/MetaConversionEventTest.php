<?php

namespace App\Modules\Marketing\Tests\Unit;

use App\Modules\Marketing\Domain\MetaConversionEvent;
use App\Modules\Shared\Domain\ClickIds;
use Carbon\CarbonImmutable;
use PHPUnit\Framework\TestCase;

/**
 * BD1c: Conversions API normalization and hashing, the money-safe JSON value, and the click ids.
 */
class MetaConversionEventTest extends TestCase
{
    public function test_normalization(): void
    {
        $this->assertSame('8801712345678', MetaConversionEvent::phone('01712345678'));
        $this->assertSame('8801712345678', MetaConversionEvent::phone('+880 1712-345678'));
        $this->assertNull(MetaConversionEvent::phone('12345'));
        $this->assertNull(MetaConversionEvent::phone(null));

        $this->assertSame(['first' => 'rina', 'last' => 'akter'], MetaConversionEvent::names('  Rina  Begum AKTER '));
        $this->assertSame(['first' => 'রিনা', 'last' => null], MetaConversionEvent::names('রিনা'));
        $this->assertSame(['first' => null, 'last' => null], MetaConversionEvent::names(''));

        $this->assertSame('coxsbazar', MetaConversionEvent::city("Cox's Bazar"));
        $this->assertNull(MetaConversionEvent::city(' '));
    }

    public function test_purchase_payload_and_json_value(): void
    {
        $event = MetaConversionEvent::purchase([
            'number' => 'WEB-000007',
            'placed_at' => CarbonImmutable::parse('2026-11-24T10:00:00Z'),
            'currency' => 'BDT',
            'total' => '1234.50',
            'contact_name' => 'Rina Akter',
            'contact_email' => ' Rina@Example.TEST ',
            'contact_phone' => '01712345678',
            'customer_id' => '0193A',
            'district' => 'Dhaka',
            'ip' => 'not-an-ip',
            'user_agent' => null,
            'tracking_ids' => ['fbp' => 'fb.1.1.2', 'ttp' => 'x'],
            'lines' => [
                ['sku' => 'SHIRT', 'variant_id' => 'v1', 'quantity' => '2.000'],
                ['sku' => null, 'variant_id' => 'v2', 'quantity' => '0.500'],
                ['sku' => 'SHIRT', 'variant_id' => 'v1', 'quantity' => '1.000'],
            ],
        ], 'https://shop.test/order/WEB-000007');

        $this->assertSame(1795514400, $event['event_time']);
        $this->assertSame('WEB-000007', $event['event_id']);
        $this->assertSame([hash('sha256', 'rina@example.test')], $event['user_data']['em']);
        $this->assertSame([hash('sha256', '0193a')], $event['user_data']['external_id']);
        $this->assertSame('fb.1.1.2', $event['user_data']['fbp']);
        $this->assertArrayNotHasKey('client_ip_address', $event['user_data']);
        $this->assertArrayNotHasKey('client_user_agent', $event['user_data']);
        $this->assertArrayNotHasKey('ttp', $event['user_data']);
        $this->assertSame(['SHIRT', 'v2'], $event['custom_data']['content_ids']);
        $this->assertSame(4, $event['custom_data']['num_items']);

        $json = MetaConversionEvent::json(MetaConversionEvent::body($event, 'TOKEN', null));
        $this->assertStringContainsString('"value":1234.50', $json);
        $this->assertStringNotContainsString('test_event_code', $json);
        $this->assertStringContainsString('"test_event_code":"T1"', MetaConversionEvent::json(MetaConversionEvent::body($event, 'TOKEN', 'T1')));
        $this->assertSame('https://graph.facebook.com/v21.0/123/events', MetaConversionEvent::url('123'));
    }

    public function test_click_ids(): void
    {
        $this->assertNull(ClickIds::collect([], null, 1));
        $this->assertNull(ClickIds::collect(['_fbp' => ''], ['landing_path' => '/p/x'], 1));
        $this->assertSame(
            ['fbp' => 'fb.1.2.3', 'fbc' => 'fb.1.1700000000000.abc', 'gclid' => 'g1'],
            ClickIds::collect(['_fbp' => 'fb.1.2.3'], ['landing_path' => '/p/x?fbclid=abc&gclid=g0', 'gclid' => 'g1'], 1700000000000),
        );
        $this->assertSame(['ttclid' => str_repeat('t', 200)], ClickIds::collect([], ['ttclid' => str_repeat('t', 200), 'gclid' => str_repeat('g', 201)], 1));
    }
}
