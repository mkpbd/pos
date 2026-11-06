<?php

use App\Modules\Purchasing\Presentation\Http\Controllers\ApprovalController;
use App\Modules\Purchasing\Presentation\Http\Controllers\GoodsReceiptController;
use App\Modules\Purchasing\Presentation\Http\Controllers\LandedCostVoucherController;
use App\Modules\Purchasing\Presentation\Http\Controllers\PurchaseOrderController;
use App\Modules\Purchasing\Presentation\Http\Controllers\ReorderSuggestionController;
use App\Modules\Purchasing\Presentation\Http\Controllers\RequisitionController;
use App\Modules\Purchasing\Presentation\Http\Controllers\RfqController;
use App\Modules\Purchasing\Presentation\Http\Controllers\SupplierPaymentController;
use App\Modules\Purchasing\Presentation\Http\Controllers\SupplierPerformanceController;
use App\Modules\Purchasing\Presentation\Http\Controllers\SupplierProductController;
use Illuminate\Support\Facades\Route;

Route::prefix('purchasing')->middleware(['auth:sanctum', 'tenant'])->group(function () {
    Route::get('orders', [PurchaseOrderController::class, 'index'])->middleware('can:purchases.view');
    Route::post('orders', [PurchaseOrderController::class, 'store'])->middleware('can:purchases.manage');
    Route::get('orders/{order}', [PurchaseOrderController::class, 'show'])->middleware('can:purchases.view');
    Route::put('orders/{order}', [PurchaseOrderController::class, 'update'])->middleware('can:purchases.manage');
    Route::post('orders/{order}/place', [PurchaseOrderController::class, 'place'])->middleware('can:purchases.manage');
    Route::post('orders/{order}/cancel', [PurchaseOrderController::class, 'cancel'])->middleware('can:purchases.manage');

    Route::get('receipts', [GoodsReceiptController::class, 'index'])->middleware('can:purchases.view');
    Route::post('receipts', [GoodsReceiptController::class, 'store'])->middleware('can:purchases.receive');
    Route::get('receipts/{receipt}', [GoodsReceiptController::class, 'show'])->middleware('can:purchases.view');
    Route::post('receipts/{receipt}/returns', [GoodsReceiptController::class, 'storeReturn'])->middleware('can:purchases.return');

    Route::get('returns', [GoodsReceiptController::class, 'returns'])->middleware('can:purchases.view');
    Route::get('returns/{purchaseReturn}', [GoodsReceiptController::class, 'showReturn'])->middleware('can:purchases.view');

    Route::get('payments', [SupplierPaymentController::class, 'index'])->middleware('can:purchases.view');
    Route::post('payments', [SupplierPaymentController::class, 'store'])->middleware('can:purchases.pay');
    Route::get('supplier-balances', [SupplierPaymentController::class, 'balances'])->middleware('can:purchases.view');
    Route::get('suppliers/{supplierId}/statement', [SupplierPaymentController::class, 'statement'])->whereUuid('supplierId')->middleware('can:purchases.view');

    // SC1: supplier catalog.
    Route::get('supplier-products', [SupplierProductController::class, 'index'])->middleware('can:purchases.view');
    Route::get('supplier-products/lookup', [SupplierProductController::class, 'lookup'])->middleware('can:purchases.view');
    Route::post('supplier-products', [SupplierProductController::class, 'store'])->middleware('can:purchases.manage');
    Route::patch('supplier-products/{supplierProduct}', [SupplierProductController::class, 'update'])->whereUuid('supplierProduct')->middleware('can:purchases.manage');
    Route::delete('supplier-products/{supplierProduct}', [SupplierProductController::class, 'destroy'])->whereUuid('supplierProduct')->middleware('can:purchases.manage');
    Route::post('supplier-products/{supplierProduct}/preferred', [SupplierProductController::class, 'prefer'])->whereUuid('supplierProduct')->middleware('can:purchases.manage');

    // SC1: reorder suggestions → draft purchase orders and replenishment transfers.
    Route::get('reorder-suggestions', [ReorderSuggestionController::class, 'index'])->middleware('can:purchases.view');
    Route::post('reorder-suggestions/purchase-orders', [ReorderSuggestionController::class, 'purchaseOrders'])->middleware(['can:purchases.manage', 'idempotent']);
    Route::post('reorder-suggestions/transfers', [ReorderSuggestionController::class, 'transfers'])->middleware(['can:inventory.transfer', 'idempotent']);

    // SC2: approval limits, purchase order approval, requisitions, RFQs and the approvals inbox.
    // Routes without a `can:` guard check "any of" permissions in the controller.
    Route::get('approval-settings', [ApprovalController::class, 'settings']);
    Route::patch('approval-settings', [ApprovalController::class, 'updateSettings'])->middleware('can:purchases.settings');
    Route::get('approvals', [ApprovalController::class, 'index']);

    Route::post('orders/{order}/submit', [PurchaseOrderController::class, 'submit'])->middleware(['can:purchases.manage', 'idempotent']);
    Route::post('orders/{order}/approve', [PurchaseOrderController::class, 'approve'])->middleware('idempotent');
    Route::post('orders/{order}/reject', [PurchaseOrderController::class, 'reject'])->middleware('idempotent');

    Route::post('reorder-suggestions/requisitions', [ReorderSuggestionController::class, 'requisitions'])->middleware(['can:purchases.request', 'idempotent']);

    Route::get('requisitions', [RequisitionController::class, 'index']);
    Route::get('requisitions/estimates', [RequisitionController::class, 'estimates']);
    Route::post('requisitions', [RequisitionController::class, 'store'])->middleware('can:purchases.request');
    Route::get('requisitions/{requisition}', [RequisitionController::class, 'show'])->whereUuid('requisition');
    Route::put('requisitions/{requisition}', [RequisitionController::class, 'update'])->whereUuid('requisition');
    Route::post('requisitions/{requisition}/submit', [RequisitionController::class, 'submit'])->whereUuid('requisition')->middleware('idempotent');
    Route::post('requisitions/{requisition}/approve', [RequisitionController::class, 'approve'])->whereUuid('requisition')->middleware('idempotent');
    Route::post('requisitions/{requisition}/reject', [RequisitionController::class, 'reject'])->whereUuid('requisition')->middleware('idempotent');
    Route::post('requisitions/{requisition}/cancel', [RequisitionController::class, 'cancel'])->whereUuid('requisition')->middleware('idempotent');
    Route::post('requisitions/{requisition}/convert', [RequisitionController::class, 'convert'])->whereUuid('requisition')->middleware(['can:purchases.manage', 'idempotent']);

    Route::get('rfqs', [RfqController::class, 'index'])->middleware('can:purchases.view');
    Route::post('rfqs', [RfqController::class, 'store'])->middleware('can:purchases.manage');
    Route::get('rfqs/{rfq}', [RfqController::class, 'show'])->whereUuid('rfq')->middleware('can:purchases.view');
    Route::put('rfqs/{rfq}', [RfqController::class, 'update'])->whereUuid('rfq')->middleware('can:purchases.manage');
    Route::post('rfqs/{rfq}/suppliers', [RfqController::class, 'invite'])->whereUuid('rfq')->middleware(['can:purchases.manage', 'idempotent']);
    Route::delete('rfqs/{rfq}/suppliers/{supplierId}', [RfqController::class, 'removeSupplier'])->whereUuid(['rfq', 'supplierId'])->middleware('can:purchases.manage');
    Route::get('rfqs/{rfq}/suppliers/{supplierId}/pdf', [RfqController::class, 'pdf'])->whereUuid(['rfq', 'supplierId'])->middleware('can:purchases.view');
    Route::post('rfqs/{rfq}/send', [RfqController::class, 'send'])->whereUuid('rfq')->middleware(['can:purchases.manage', 'idempotent']);
    Route::post('rfqs/{rfq}/quotes', [RfqController::class, 'quote'])->whereUuid('rfq')->middleware(['can:purchases.manage', 'idempotent']);
    Route::get('rfqs/{rfq}/comparison', [RfqController::class, 'comparison'])->whereUuid('rfq')->middleware('can:purchases.view');
    Route::post('rfqs/{rfq}/award', [RfqController::class, 'award'])->whereUuid('rfq')->middleware(['can:purchases.manage', 'idempotent']);
    Route::post('rfqs/{rfq}/close', [RfqController::class, 'close'])->whereUuid('rfq')->middleware(['can:purchases.manage', 'idempotent']);
    Route::post('rfqs/{rfq}/cancel', [RfqController::class, 'cancel'])->whereUuid('rfq')->middleware(['can:purchases.manage', 'idempotent']);

    // SC3: landed cost vouchers and supplier performance.
    Route::get('landed-cost-vouchers', [LandedCostVoucherController::class, 'index'])->middleware('can:purchases.view');
    Route::post('landed-cost-vouchers/preview', [LandedCostVoucherController::class, 'preview'])->middleware('can:purchases.landed_cost');
    Route::post('landed-cost-vouchers', [LandedCostVoucherController::class, 'store'])->middleware('can:purchases.landed_cost');
    Route::get('landed-cost-vouchers/{landedCostVoucher}', [LandedCostVoucherController::class, 'show'])->whereUuid('landedCostVoucher')->middleware('can:purchases.view');
    Route::put('landed-cost-vouchers/{landedCostVoucher}', [LandedCostVoucherController::class, 'update'])->whereUuid('landedCostVoucher')->middleware('can:purchases.landed_cost');
    Route::delete('landed-cost-vouchers/{landedCostVoucher}', [LandedCostVoucherController::class, 'destroy'])->whereUuid('landedCostVoucher')->middleware('can:purchases.landed_cost');
    Route::post('landed-cost-vouchers/{landedCostVoucher}/post', [LandedCostVoucherController::class, 'post'])->whereUuid('landedCostVoucher')->middleware(['can:purchases.landed_cost', 'idempotent']);

    Route::get('supplier-performance', [SupplierPerformanceController::class, 'index'])->middleware('can:purchases.view');
    Route::get('suppliers/{supplierId}/performance', [SupplierPerformanceController::class, 'show'])->whereUuid('supplierId')->middleware('can:purchases.view');
});
