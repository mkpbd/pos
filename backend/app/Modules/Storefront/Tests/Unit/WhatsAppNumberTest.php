<?php

namespace App\Modules\Storefront\Tests\Unit;

use App\Modules\Storefront\Domain\WhatsAppNumber;
use PHPUnit\Framework\TestCase;

/**
 * P2b: WhatsApp numbers as wa.me wants them (E.164 digits without "+").
 */
class WhatsAppNumberTest extends TestCase
{
    public function test_numbers_are_normalized(): void
    {
        foreach ([
            '01712345678' => '8801712345678',
            '017-1234-5678' => '8801712345678',
            '+8801712345678' => '8801712345678',
            '008801912345678' => '8801912345678',
            '+1 (415) 555-0132' => '14155550132',
            '0044 20 7946 0958' => '442079460958',
        ] as $input => $expected) {
            $this->assertSame($expected, WhatsAppNumber::normalize((string) $input), (string) $input);
        }
        $this->assertSame('8801812345678', WhatsAppNumber::normalize('8801812345678'));
        foreach ([null, '', '0171234567', '01212345678', '12345', '+0123456789', '+1234567', '+1234567890123456', 'whatsapp me'] as $bad) {
            $this->assertNull(WhatsAppNumber::normalize($bad), (string) $bad);
        }
    }
}
