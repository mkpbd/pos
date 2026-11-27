<?php

namespace App\Modules\Inventory\Application\Contracts;

use App\Modules\Inventory\Domain\SerialStatus;
use App\Modules\Inventory\Domain\StockReference;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use Illuminate\Validation\ValidationException;

/**
 * ST2d: the serial-number register (one row per serial-numbered unit of a variant, plus an
 * append-only event history). Other modules change it only through this contract.
 *
 * Every write method:
 *  - must run inside the caller's database transaction (the document's), and locks the serial
 *    rows it changes (FOR UPDATE, in a fixed order);
 *  - trims serials and matches them case-insensitively; a serial entered twice in one call
 *    throws a ValidationException on `serials` (callers validate count = quantity and
 *    duplicates themselves first, to report them on their own field keys);
 *  - appends one event per serial carrying the document reference.
 *
 * Call issue() / dispatch() BEFORE StockLedger::post() of the same units: the legacy rule
 * reads the store's quantity on hand as it was before the units left.
 */
interface SerialRegister
{
    /**
     * Serials come into stock at the store (status in_stock). New serials are created; serials
     * that left the business (sold, returned_to_supplier, written_off) come back.
     *
     * @param  list<string>  $serials
     * @param  'received'|'adjusted_in'  $event  goods receipt / positive stock adjustment
     *
     * @throws BusinessRuleViolation SERIAL_IN_STOCK (422, details.serials) when a serial is already in_stock or in_transit
     * @throws ValidationException
     */
    public function receive(string $storeId, string $variantId, array $serials, StockReference $reference, string $event = 'received'): void;

    /**
     * Serials leave the business from the store: $status is Sold, ReturnedToSupplier or WrittenOff
     * (event sold / returned_to_supplier / written_off); the serial's store becomes null.
     * Each serial must be in_stock at that store. Legacy rule: a serial unknown to the register
     * is accepted (and created with $status) while the store holds unregistered units of the
     * variant (quantity on hand − registered in_stock serials there), so stock from before
     * the register still sells.
     *
     * A written-off customer return is returnFromCustomer() then issue(WrittenOff).
     *
     * @param  list<string>  $serials
     *
     * @throws BusinessRuleViolation SERIAL_NOT_IN_STOCK (422, details.serials)
     * @throws ValidationException
     */
    public function issue(string $storeId, string $variantId, array $serials, SerialStatus $status, StockReference $reference): void;

    /**
     * A customer brings serials back to the store (sale return restocked, sale cancelled):
     * sold → in_stock; unknown serials are created in_stock. Event `returned`.
     *
     * @param  list<string>  $serials
     *
     * @throws BusinessRuleViolation SERIAL_IN_STOCK (422, details.serials) when a serial is already in_stock or in_transit
     * @throws ValidationException
     */
    public function returnFromCustomer(string $storeId, string $variantId, array $serials, StockReference $reference): void;

    /**
     * Transfer dispatch: in_stock at the source → in_transit (same legacy rule as issue()).
     * Event `transferred_out`.
     *
     * @param  list<string>  $serials
     *
     * @throws BusinessRuleViolation SERIAL_NOT_IN_STOCK (422, details.serials)
     * @throws ValidationException
     */
    public function dispatch(string $fromStoreId, string $variantId, array $serials, StockReference $reference): void;

    /**
     * Transfer receipt (or a cancelled transfer back at its source): in_transit → in_stock
     * at the store. Event `transferred_in`.
     *
     * @param  list<string>  $serials
     *
     * @throws BusinessRuleViolation SERIAL_NOT_IN_STOCK (422, details.serials) when a serial is not in transit
     */
    public function arrive(string $toStoreId, string $variantId, array $serials, StockReference $reference): void;

    /**
     * Serials in stock at the store, sorted.
     *
     * @return list<string>
     */
    public function inStock(string $storeId, string $variantId): array;
}
