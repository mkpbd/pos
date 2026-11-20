<?php

namespace App\Modules\Storefront\Infrastructure\Models;

use App\Modules\Shared\Infrastructure\Persistence\Concerns\BelongsToOrganization;
use App\Modules\Shared\Infrastructure\Persistence\Concerns\ChangesStorefrontContent;
use App\Modules\Shared\Infrastructure\Persistence\Concerns\TracksAuthor;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

/**
 * @property string $id
 * @property string $organization_id
 * @property bool $is_enabled
 * @property string $site_name
 * @property ?string $meta_description
 * @property ?string $fulfilment_store_id stock location deciding online availability
 * @property bool $guest_checkout_enabled shoppers may check out without an account
 * @property int $return_window_days days after delivery a web order can be returned (0 = no online returns; E10b)
 * @property bool $allow_indexing search engines may index the store (false: robots Disallow + noindex; E12)
 * @property bool $bangla_enabled shoppers may switch the store to Bangla (E12b)
 * @property string $default_locale `en` or `bn` (must be enabled; E12b)
 * @property bool $bangla_digits amounts and numbers in Bengali digits when reading in Bangla (E12b)
 * @property bool $share_buttons the share bar on product, campaign and blog pages (P2b)
 * @property ?string $whatsapp_number E.164 digits without "+" for wa.me links (P2b)
 * @property bool $whatsapp_order_button "Order on WhatsApp" on product pages while a number is set (P2b)
 * @property bool $whatsapp_chat_button the floating WhatsApp chat button while a number is set (P2b)
 * @property bool $assistant_enabled the shopper support assistant is switched on for the store (AI2b)
 * @property ?string $assistant_name its name (null = "Shop assistant"; AI2b)
 * @property ?string $assistant_greeting its greeting (AI2b)
 * @property ?array<string, array<string, string>> $assistant_translations {bn: {greeting}} (AI2b)
 * @property int $assistant_daily_limit new assistant conversations per store-local day (AI2b)
 * @property ?string $assistant_handoff whatsapp | contact | none (null = WhatsApp when a number is set, else contact; AI2b)
 */
#[Fillable(['organization_id', 'is_enabled', 'site_name', 'meta_description', 'fulfilment_store_id', 'guest_checkout_enabled', 'return_window_days', 'allow_indexing', 'bangla_enabled', 'default_locale', 'bangla_digits',
    'share_buttons', 'whatsapp_number', 'whatsapp_order_button', 'whatsapp_chat_button',
    'assistant_enabled', 'assistant_name', 'assistant_greeting', 'assistant_translations', 'assistant_daily_limit', 'assistant_handoff'])]
class StorefrontSettings extends Model
{
    use BelongsToOrganization, ChangesStorefrontContent, HasUuids, TracksAuthor;

    protected $table = 'storefront_settings';

    protected $attributes = [
        'is_enabled' => false,
        'guest_checkout_enabled' => true,
        'return_window_days' => 7,
        'allow_indexing' => true,
        'bangla_enabled' => true,
        'default_locale' => 'en',
        'bangla_digits' => false,
        'share_buttons' => true,
        'whatsapp_order_button' => true,
        'whatsapp_chat_button' => true,
        'assistant_enabled' => false,
        'assistant_daily_limit' => 200,
    ];

    protected function casts(): array
    {
        return ['is_enabled' => 'boolean', 'guest_checkout_enabled' => 'boolean', 'return_window_days' => 'integer', 'allow_indexing' => 'boolean', 'bangla_enabled' => 'boolean', 'bangla_digits' => 'boolean',
            'share_buttons' => 'boolean', 'whatsapp_order_button' => 'boolean', 'whatsapp_chat_button' => 'boolean',
            'assistant_enabled' => 'boolean', 'assistant_translations' => 'array', 'assistant_daily_limit' => 'integer'];
    }

    /**
     * P2b: whether the "Order on WhatsApp" button shows (switched on and a number set).
     */
    public function showsWhatsAppOrderButton(): bool
    {
        return $this->whatsapp_order_button && $this->whatsapp_number !== null;
    }

    /**
     * P2b: whether the floating WhatsApp chat button shows (switched on and a number set).
     */
    public function showsWhatsAppChatButton(): bool
    {
        return $this->whatsapp_chat_button && $this->whatsapp_number !== null;
    }

    /**
     * AI2b: the chosen hand-off of the shopper assistant (unset: WhatsApp when a number is set,
     * else the contact page).
     */
    public function assistantHandoffChoice(): string
    {
        return $this->assistant_handoff ?? ($this->whatsapp_number !== null ? 'whatsapp' : 'contact');
    }
}
