<?php

namespace App\Modules\Orders\Application\Actions;

use App\Modules\Branches\Application\Contracts\BranchDirectory;
use App\Modules\Geography\Application\Contracts\GeoDirectory;
use App\Modules\OnlineCatalog\Application\Contracts\StorefrontCatalog;
use App\Modules\Orders\Application\Contracts\OrderForms;
use App\Modules\Orders\Application\Services\CheckoutQuoter;
use App\Modules\Orders\Infrastructure\Models\Order;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Shared\Domain\CampaignAttribution;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use App\Modules\Shared\Domain\ValueObjects\Decimal;
use App\Modules\Storefront\Application\Queries\StorefrontConfig;
use Illuminate\Validation\ValidationException;

/**
 * P2a: the one-product order page (a landing page's `order_form` element). The form must be
 * live on the store (OrderForms; else 422 ORDER_FORM_UNAVAILABLE) and the body must keep to
 * it: one line of the form's product (a whole quantity from 1 to the form's maximum) and at
 * most one line of its add-on product (quantity 1); the e-mail and note only when the form
 * asks for them (e-mail required when it says so); cash on delivery only for `cod_only`.
 *
 * Placing hands the lines to PlaceOrder::direct() — the same transaction, repricing,
 * promotions (no coupon), stock, numbering, payment and notifications as the cart checkout —
 * with source `landing_page`; no cart is read or changed. The preview prices the same lines
 * through the same CheckoutQuoter path.
 */
class PlaceDirectOrder
{
    public function __construct(
        private readonly OrderForms $forms,
        private readonly StorefrontCatalog $catalog,
        private readonly CheckoutQuoter $quoter,
        private readonly PlaceOrder $place,
        private readonly GeoDirectory $geo,
        private readonly StorefrontConfig $storefront,
        private readonly BranchDirectory $branches,
        private readonly TenantContext $tenant,
    ) {}

    /**
     * The recomputed order summary for the form's lines (any subset of the delivery details).
     *
     * @param  array<string, mixed>  $data  validated preview body
     * @return array<string, mixed> the checkout preview shape
     *
     * @throws BusinessRuleViolation|ValidationException
     */
    public function preview(array $data, ?string $customerId): array
    {
        $form = $this->form($data);
        $this->ensureCheckoutAvailable();
        $lines = $this->lines($form, $data['lines']);
        $input = [
            'address' => isset($data['address']['district_id']) ? ['district_id' => (int) $data['address']['district_id']] : null,
            'shipping_method_id' => $data['shipping_method_id'] ?? null,
            'payment_method' => $form['payment'] === 'cod_only' && ($data['payment_method'] ?? null) !== null ? 'cod' : ($data['payment_method'] ?? null),
        ];

        return $this->quoter->quoteLines($lines, $input, $customerId, autoPickMethod: true)['preview'];
    }

    /**
     * @param  array<string, mixed>  $data  validated place body
     * @param  array{customer_id: string, account_id: string}|null  $customer
     * @param  array{ip: ?string, user_agent: ?string, site_url: string}  $client
     * @return array{order: Order, access_token: ?string}
     *
     * @throws BusinessRuleViolation|ValidationException
     */
    public function place(array $data, ?array $customer, array $client): array
    {
        $form = $this->form($data);
        $lines = $this->lines($form, $data['lines']);

        $errors = [];
        $email = isset($data['contact']['email']) && is_string($data['contact']['email']) && trim($data['contact']['email']) !== '' ? trim($data['contact']['email']) : null;
        if ($form['email'] === 'required' && $email === null) {
            $errors['contact.email'] = ['Enter your e-mail address.'];
        } elseif ($form['email'] === 'hidden' && $email !== null) {
            $errors['contact.email'] = ['This order form does not ask for an e-mail address.'];
        }
        $note = isset($data['note']) && is_string($data['note']) && trim($data['note']) !== '' ? trim($data['note']) : null;
        if ($form['note'] === 'hidden' && $note !== null) {
            $errors['note'] = ['This order form does not take a note.'];
        }
        if ($form['payment'] === 'cod_only' && $data['payment_method'] !== 'cod') {
            $errors['payment_method'] = ['This product is sold with cash on delivery only.'];
        }
        $districtId = (int) $data['address']['district_id'];
        $divisionId = isset($data['address']['division_id']) ? (int) $data['address']['division_id'] : $this->divisionOf($districtId);
        if ($divisionId === null || ! $this->geo->districtInDivision($districtId, $divisionId)) {
            $errors['address.district_id'] = ['The district is not in the selected division.'];
        }
        if ($errors !== []) {
            throw ValidationException::withMessages($errors);
        }

        $attribution = CampaignAttribution::sanitize($data['attribution'] ?? null) ?? [];
        // The page the order was placed on (for "top landing pages"), set by the server.
        if ($form['path'] !== null) {
            $attribution['order_page'] = $form['path'];
        }

        $name = trim((string) $data['contact']['name']);
        $phone = (string) $data['contact']['phone'];

        return $this->place->direct($lines, $customer, [
            'contact' => ['name' => $name, 'email' => $email, 'phone' => $phone],
            'address' => [
                'recipient_name' => $name,
                'phone' => $phone,
                'division_id' => $divisionId,
                'district_id' => $districtId,
                'area' => $this->blankToNull($data['address']['area'] ?? null),
                'address_line' => trim((string) $data['address']['address_line']),
                'postcode' => $this->blankToNull($data['address']['postcode'] ?? null),
            ],
            'shipping_method_id' => $data['shipping_method_id'],
            'payment_method' => $data['payment_method'],
            'notes' => $note,
            'expected_total' => $data['expected_total'],
            'source' => Order::SOURCE_LANDING_PAGE,
            'attribution' => $attribution === [] ? null : $attribution,
        ], $client);
    }

    /**
     * @param  array<string, mixed>  $data
     * @return array<string, mixed>
     */
    private function form(array $data): array
    {
        $form = $this->forms->find((string) $data['document_id'], (string) $data['element_id']);
        if ($form === null) {
            throw new BusinessRuleViolation('ORDER_FORM_UNAVAILABLE', 'This order form is not available right now.');
        }

        return $form;
    }

    private function ensureCheckoutAvailable(): void
    {
        $storeId = $this->storefront->settings()->fulfilment_store_id;
        $store = $storeId === null ? null : $this->branches->store($storeId, $this->tenant->requireOrganization());
        if ($store === null || ! $store['is_active'] || ! $store['branch_is_active']) {
            throw new BusinessRuleViolation('CHECKOUT_UNAVAILABLE', 'Online ordering is not available right now. Please try again later.', ['reason' => 'no_fulfilment_store']);
        }
    }

    /**
     * The lines checked against the form: exactly one line of the form's product (whole
     * quantity 1 … the form's maximum) and at most one of its add-on (quantity 1). A variant
     * that is not of these products, or no longer exists, is a field error.
     *
     * @param  array<string, mixed>  $form
     * @param  list<array{variant_id: string, quantity: mixed}>  $lines
     * @return list<array{variant_id: string, quantity: string}>
     *
     * @throws ValidationException
     */
    private function lines(array $form, array $lines): array
    {
        $variants = $this->catalog->variantsForCart(array_values(array_unique(array_map(fn (array $l) => strtolower((string) $l['variant_id']), $lines))));
        $errors = [];
        $main = 0;
        $upsell = 0;
        $result = [];
        foreach (array_values($lines) as $i => $line) {
            $variantId = strtolower((string) $line['variant_id']);
            $productId = $variants[$variantId]['product_id'] ?? null;
            $quantity = (string) $line['quantity'];
            if ($productId !== null && $productId === $form['product_id']) {
                $main++;
                if (preg_match('/^\d+(\.0+)?$/', $quantity) !== 1 || (int) $quantity < 1 || (int) $quantity > $form['quantity_max']) {
                    $errors["lines.{$i}.quantity"] = ["Choose a quantity from 1 to {$form['quantity_max']}."];
                }
            } elseif ($productId !== null && $productId === $form['upsell_product_id']) {
                $upsell++;
                if (Decimal::compare(Decimal::round($quantity, 3), '1') !== 0) {
                    $errors["lines.{$i}.quantity"] = ['The add-on is ordered once.'];
                }
            } else {
                $errors["lines.{$i}.variant_id"] = ['Choose one of the options of this product.'];

                continue;
            }
            $result[] = ['variant_id' => $variantId, 'quantity' => (string) (int) $quantity];
        }
        if ($errors === [] && $main !== 1) {
            $errors['lines'] = ['Order the product of this form once, with at most one add-on.'];
        }
        if ($errors === [] && $upsell > 1) {
            $errors['lines'] = ['The add-on can be added once.'];
        }
        if ($errors !== []) {
            throw ValidationException::withMessages($errors);
        }

        return $result;
    }

    private function divisionOf(int $districtId): ?int
    {
        foreach ($this->geo->districts() as $district) {
            if ($district['id'] === $districtId) {
                return $district['division_id'];
            }
        }

        return null;
    }

    private function blankToNull(mixed $value): ?string
    {
        return is_string($value) && trim($value) !== '' ? trim($value) : null;
    }
}
