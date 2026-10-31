<?php

namespace App\Modules\Orders\Tests\Unit;

use App\Modules\Orders\Infrastructure\Notifications\OrderConfirmation;
use Illuminate\Notifications\AnonymousNotifiable;
use PHPUnit\Framework\TestCase;

class OrderConfirmationTest extends TestCase
{
    public function test_the_payment_deadline_is_shown_in_the_organization_time_zone(): void
    {
        $order = [
            'number' => 'WEB-000001', 'status_label' => 'Awaiting payment', 'currency' => 'BDT',
            'contact' => ['name' => 'Rahim'],
            'lines' => [['product_name' => 'Juice', 'variant_name' => null, 'quantity' => '1', 'line_total' => '25.00']],
            'subtotal' => '25.00', 'prices_include_tax' => false, 'tax_total' => '0.00',
            'shipping_method_name' => 'Home delivery', 'shipping_total' => '60.00', 'cod_fee' => '0.00',
            'total' => '85.00', 'payment_method_label' => 'Bank transfer', 'shipping_address' => null,
            'payment_instructions' => 'Demo Bank, account 0000000000',
            'expires_at' => '2026-11-02T06:30:00+00:00',
        ];

        $mail = (new OrderConfirmation('Demo Mart', $order, 'https://shop.test/order/WEB-000001', 'Asia/Dhaka'))
            ->toMail(new AnonymousNotifiable);

        $this->assertContains('Please pay before 2 Nov 2026, 12:30 PM (Asia/Dhaka); unpaid orders are cancelled after that.', $mail->introLines);
    }
}
