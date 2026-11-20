<?php

namespace App\Modules\AI\Application\Tools\Shopper;

use App\Modules\AI\Application\Tools\AiTool;
use App\Modules\AI\Application\Tools\Arguments;
use App\Modules\AI\Application\Tools\ToolOutput;
use App\Modules\AI\Domain\Llm\ToolDefinition;
use App\Modules\Cms\Application\Contracts\PageDirectory;
use App\Modules\Geography\Application\Contracts\GeoDirectory;
use App\Modules\OnlinePayments\Application\Contracts\CheckoutPaymentMethods;
use App\Modules\Shared\Application\Localization\LocaleContext;
use App\Modules\Shared\Domain\ValueObjects\Decimal;
use App\Modules\Shipping\Application\Contracts\ShippingRates;
use App\Modules\Storefront\Application\Queries\StorefrontConfig;
use Illuminate\Support\Facades\Validator;

/**
 * AI2b: the store's public policies — delivery zones (with up to 20 district names each),
 * methods, fees and estimated days; enabled payment methods with their public instructions;
 * the online return window; the contact details shown in the store footer. Gateway settings
 * and anything else non-public never leave the server.
 */
final class StorePoliciesTool implements AiTool
{
    public const NAME = 'store_policies';

    public const TOPICS = ['delivery', 'payment', 'returns', 'contact', 'all'];

    private const MAX_ZONES = 15;

    private const MAX_DISTRICTS = 20;

    public const CONTACT_PAGE_SLUG = 'contact';

    public function __construct(
        private readonly ShippingRates $shipping,
        private readonly GeoDirectory $geo,
        private readonly CheckoutPaymentMethods $payments,
        private readonly StorefrontConfig $storefront,
        private readonly PageDirectory $pages,
        private readonly LocaleContext $locale,
        private readonly ShopperFindings $findings,
        private readonly string $currency,
    ) {}

    public function definition(): ToolDefinition
    {
        return new ToolDefinition(
            self::NAME,
            'The store\'s policies: "delivery" (zones and the districts they cover, delivery methods, fees, free-delivery thresholds, '
            .'cash-on-delivery fees, estimated days), "payment" (accepted payment methods), "returns" (return window and rules), '
            .'"contact" (phone, e-mail, address, contact page) or "all".',
            Arguments::schema([
                'topic' => ['type' => 'string', 'enum' => self::TOPICS, 'description' => 'Which policy'],
            ], ['topic']),
        );
    }

    public function run(array $input): ToolOutput
    {
        $args = Validator::make(Arguments::only($input, ['topic']), [
            'topic' => ['required', 'string', 'in:'.implode(',', self::TOPICS)],
        ])->validate();
        $topic = $args['topic'];
        $all = $topic === 'all';

        $data = [];
        if ($all || $topic === 'delivery') {
            $data['delivery'] = $this->delivery();
        }
        if ($all || $topic === 'payment') {
            $data['payment'] = $this->payment();
        }
        if ($all || $topic === 'returns') {
            $data['returns'] = $this->returns();
        }
        if ($all || $topic === 'contact') {
            $data['contact'] = $this->contact();
        }

        return new ToolOutput(data: $data, params: ['topic' => $topic]);
    }

    /**
     * @return array<string, mixed>
     */
    private function delivery(): array
    {
        $zones = array_values(array_filter($this->shipping->activeZones(), fn (array $z) => $z['covers_districts'] && $z['methods'] !== []));
        if ($zones === []) {
            return ['zones' => [], 'note' => 'Delivery is not set up yet.'];
        }

        // District → zone through the methods each district is offered.
        $zoneOfMethod = [];
        foreach ($zones as $zone) {
            foreach ($zone['methods'] as $method) {
                $zoneOfMethod[$method['id']] = $zone['id'];
            }
        }
        $districtIds = [];
        foreach ($this->shipping->districtMethods()['districts'] as $districtId => $methodIds) {
            $zoneId = $zoneOfMethod[$methodIds[0] ?? ''] ?? null;
            if ($zoneId !== null) {
                $districtIds[$zoneId][] = (int) $districtId;
            }
        }
        $names = [];
        $bangla = $this->locale->current() === LocaleContext::BN;
        foreach ($this->geo->districts() as $district) {
            $names[$district['id']] = $bangla ? $district['name_bn'] : $district['name'];
        }

        return [
            'zones' => array_map(function (array $zone) use ($districtIds, $names) {
                $districts = array_values(array_filter(array_map(fn (int $id) => $names[$id] ?? null, $districtIds[$zone['id']] ?? [])));
                sort($districts);

                return [
                    'zone' => $zone['name'],
                    'districts' => array_slice($districts, 0, self::MAX_DISTRICTS),
                    'more_districts' => max(0, count($districts) - self::MAX_DISTRICTS),
                    'methods' => array_map(fn (array $m) => [
                        'name' => $m['name'],
                        'description' => ShopperText::clip($m['description'] ?? null, 200),
                        'fee_text' => ShopperText::money($m['fee'], $this->currency),
                        'free_over_text' => ShopperText::money($m['free_over'], $this->currency),
                        'cash_on_delivery' => (bool) $m['cod_allowed'],
                        'cod_fee_text' => $m['cod_allowed'] && Decimal::compare((string) $m['cod_fee'], '0') > 0 ? ShopperText::money((string) $m['cod_fee'], $this->currency) : null,
                        'days' => ShopperText::days($m['eta_min_days'], $m['eta_max_days']),
                    ], $zone['methods']),
                ];
            }, array_slice($zones, 0, self::MAX_ZONES)),
            'note' => 'The exact fee is shown at checkout after choosing the district.',
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function payment(): array
    {
        return [
            'methods' => array_map(fn (array $m) => array_filter([
                'name' => $m['display_name'],
                'kind' => $m['code'],
                'instructions' => ShopperText::clip($m['instructions'] ?? null, 300),
                'max_order_text' => $m['code'] === 'cod' && is_numeric($m['settings']['max_order_total'] ?? null)
                    ? ShopperText::money((string) $m['settings']['max_order_total'], $this->currency) : null,
            ], fn ($v) => $v !== null), $this->payments->enabled()),
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function returns(): array
    {
        $days = $this->storefront->shopperFacts()['return_window_days'];
        if ($days > 0) {
            $this->findings->link('My orders', '/account/orders');
        }

        return [
            'online_returns' => $days > 0,
            'window_days' => $days,
            'rules' => $days > 0
                ? "A return can be requested online from the order page in the shopper's account (signed in) within {$days} days after delivery, "
                    .'for delivered and paid orders. The store reviews each request; the refund follows when the goods are received.'
                : 'Online return requests are not offered; the shopper should contact the store.',
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function contact(): array
    {
        $facts = $this->storefront->shopperFacts();
        $page = $this->pages->visibleBySlug(self::CONTACT_PAGE_SLUG);
        $path = $page === null ? null : '/pages/'.$page['slug'];
        if ($path !== null) {
            $this->findings->link((string) $page['title'], $path);
        }

        return $facts['contact'] + [
            'whatsapp' => $facts['whatsapp'],
            'contact_page' => $path,
        ];
    }
}
