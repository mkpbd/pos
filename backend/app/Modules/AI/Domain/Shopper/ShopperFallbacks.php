<?php

namespace App\Modules\AI\Domain\Shopper;

/**
 * AI2b: the fixed replies of the shopper assistant (English / Bangla) — when it cannot answer
 * (AI off, provider error, budget used up, a limit reached) or declines a request. Never an
 * error message from the provider or the server.
 */
final class ShopperFallbacks
{
    public const UNAVAILABLE = 'unavailable';

    public const BUDGET = 'budget';

    /** The conversation reached its shopper message limit. */
    public const CONVERSATION_FULL = 'conversation_full';

    /** The store's daily number of new conversations is reached. */
    public const BUSY = 'busy';

    public const REFUSED = 'refused';

    public const EMPTY = 'empty';

    private const TEXTS = [
        'en' => [
            self::UNAVAILABLE => 'Sorry, I can\'t answer right now.',
            self::BUDGET => 'Sorry, I can\'t answer right now.',
            self::CONVERSATION_FULL => 'This chat has reached its limit. Please start a new chat to ask more.',
            self::BUSY => 'Sorry, the assistant is busy right now. Please try again later.',
            self::REFUSED => 'I can only help with shopping at this store: products, delivery, payment, returns and your orders.',
            self::EMPTY => 'Sorry, I could not answer that. Could you ask it another way?',
        ],
        'bn' => [
            self::UNAVAILABLE => 'দুঃখিত, এই মুহূর্তে আমি উত্তর দিতে পারছি না।',
            self::BUDGET => 'দুঃখিত, এই মুহূর্তে আমি উত্তর দিতে পারছি না।',
            self::CONVERSATION_FULL => 'এই চ্যাটের সীমা পূর্ণ হয়েছে। আরও জানতে নতুন চ্যাট শুরু করুন।',
            self::BUSY => 'দুঃখিত, সহকারী এখন ব্যস্ত। একটু পরে আবার চেষ্টা করুন।',
            self::REFUSED => 'আমি শুধু এই দোকানের কেনাকাটায় সাহায্য করতে পারি: পণ্য, ডেলিভারি, পেমেন্ট, রিটার্ন এবং আপনার অর্ডার।',
            self::EMPTY => 'দুঃখিত, এর উত্তর দিতে পারিনি। অন্যভাবে জিজ্ঞেস করবেন?',
        ],
    ];

    private const HANDOFF = [
        'en' => ['whatsapp' => 'You can talk to us on WhatsApp.', 'contact' => 'You can contact us through our contact page.'],
        'bn' => ['whatsapp' => 'WhatsApp-এ আমাদের সাথে কথা বলতে পারেন।', 'contact' => 'যোগাযোগ পেজ থেকে আমাদের সাথে যোগাযোগ করতে পারেন।'],
    ];

    /**
     * @param  string|null  $handoff  `whatsapp` | `contact` to invite the shopper to the hand-off
     */
    public static function text(string $kind, string $language, ?string $handoff = null): string
    {
        $language = isset(self::TEXTS[$language]) ? $language : 'en';
        $text = self::TEXTS[$language][$kind] ?? self::TEXTS[$language][self::UNAVAILABLE];
        if ($handoff !== null && isset(self::HANDOFF[$language][$handoff])) {
            $text .= ' '.self::HANDOFF[$language][$handoff];
        }

        return $text;
    }
}
