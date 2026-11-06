<?php

namespace App\Modules\Purchasing\Tests\Unit;

use App\Modules\Purchasing\Domain\Procurement\ApprovalLevel;
use App\Modules\Purchasing\Domain\Procurement\ApprovalPolicy;
use InvalidArgumentException;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

class ApprovalPolicyTest extends TestCase
{
    /**
     * @return array<string, array{0: string, 1: ApprovalLevel}>
     */
    public static function amounts(): array
    {
        return [
            'zero' => ['0.00', ApprovalLevel::None],
            'at the auto limit' => ['10000.00', ApprovalLevel::None],
            'a cent above the auto limit' => ['10000.01', ApprovalLevel::Manager],
            'at the manager limit' => ['100000.00', ApprovalLevel::Manager],
            'a cent above the manager limit' => ['100000.01', ApprovalLevel::High],
            'far above' => ['98765432.10', ApprovalLevel::High],
        ];
    }

    #[DataProvider('amounts')]
    public function test_the_amount_decides_the_level_and_boundaries_belong_to_the_lower_tier(string $amount, ApprovalLevel $level): void
    {
        $this->assertSame($level, ApprovalPolicy::level($amount, '10000.00', '100000.00'));
    }

    public function test_equal_limits_skip_the_manager_tier_and_inverted_limits_are_refused(): void
    {
        $this->assertSame(ApprovalLevel::None, ApprovalPolicy::level('500.00', '500.00', '500.00'));
        $this->assertSame(ApprovalLevel::High, ApprovalPolicy::level('500.01', '500.00', '500.00'));

        $this->expectException(InvalidArgumentException::class);
        ApprovalPolicy::level('1.00', '200.00', '100.00');
    }

    public function test_pre_approval_allows_five_percent_over_the_approved_amount(): void
    {
        $this->assertSame('21000.00', ApprovalPolicy::preApprovalCeiling('20000.00'));
        $this->assertSame('105.01', ApprovalPolicy::preApprovalCeiling('100.01')); // 105.0105 → 105.01
        $this->assertTrue(ApprovalPolicy::withinPreApproval('21000.00', '20000.00'));
        $this->assertTrue(ApprovalPolicy::withinPreApproval('15000.00', '20000.00'));
        $this->assertFalse(ApprovalPolicy::withinPreApproval('21000.01', '20000.00'));
        $this->assertFalse(ApprovalPolicy::withinPreApproval('1.00', null));
    }

    public function test_share_of_an_approved_line_for_part_of_its_quantity(): void
    {
        $this->assertSame('100.00', ApprovalPolicy::share('300.00', '1', '3'));
        $this->assertSame('33.33', ApprovalPolicy::share('100.00', '1', '3'));
        $this->assertSame('66.67', ApprovalPolicy::share('100.00', '2', '3'));
        $this->assertSame('0.00', ApprovalPolicy::share('100.00', '1', '0'));
    }

    public function test_levels_name_the_permissions_that_may_approve(): void
    {
        $this->assertSame([], ApprovalLevel::None->approverPermissions());
        $this->assertSame(['purchases.approve', 'purchases.approve_high'], ApprovalLevel::Manager->approverPermissions());
        $this->assertSame(['purchases.approve_high'], ApprovalLevel::High->approverPermissions());
        $this->assertSame('purchases.approve_high', ApprovalLevel::High->requiredPermission());
        $this->assertNull(ApprovalLevel::None->requiredPermission());
    }
}
