<?php

/**
 * Kath & Home — the furniture preset demo store (DemoThemesSeeder, B11). Same shape as
 * fashion.php: Bangla on, banners reuse the product photos, ten photos (the bedside table and the
 * table lamp have none). Finishes and sizes as variants with swatches; no brands. Photo credits in
 * images/manifest.json.
 */
return [
    'name' => 'Kath & Home',
    'host' => 'furniture.shop.localhost',
    'preset' => 'furniture',
    'bangla' => true,
    'owner' => ['name' => 'Shahriar Kabir', 'email' => 'owner@furniture.test'],
    'branch' => 'Kath & Home Tejgaon',
    'sku' => 'KH',
    'meta_description' => 'Solid wood furniture, lighting, jute rugs and home decor made in Bangladesh, delivered and assembled by Kath & Home.',
    'free_delivery_over' => '20000.00',
    'coupon' => ['code' => 'HOME10', 'name' => 'Home 10', 'description' => '10% off orders over ৳30,000 with code HOME10', 'percent' => '10', 'min' => '30000'],
    'flash_sale' => [
        'name' => 'Home week', 'description' => '10% off four pieces for one week',
        'percent' => '10', 'days' => 6, 'products' => ['ceramic-vase', 'pendant-lamp', 'accent-armchair', 'platform-bed'],
    ],
    'out_of_stock' => 'table-lamp',
    // Sold at the shop counter (POS): the best sellers.
    'best_sellers' => ['ceramic-vase' => 5, 'jute-rug' => 4, 'dining-chair' => 4, 'pendant-lamp' => 3, 'coffee-table' => 2, 'three-seater-sofa' => 1],
    'swatches' => [
        'Finish' => ['Oak' => '#c8a27a', 'Walnut' => '#5c3d2e', 'White' => '#f4f1ea'],
        'Colour' => ['Oatmeal' => '#d9cdb8', 'Sage' => '#9caf88'],
    ],

    // slug => [name, photo, description, Bangla name]
    'categories' => [
        'living-room' => ['Living room', 'three-seater-sofa', 'Sofas, armchairs and coffee tables for slow evenings.', 'বসার ঘর'],
        'bedroom' => ['Bedroom', 'platform-bed', 'Solid wood beds and bedside tables for calm nights.', 'শোবার ঘর'],
        'dining' => ['Dining', 'dining-table', 'Dining tables and chairs made for long family meals.', 'খাবার ঘর'],
        'home-office' => ['Home office', 'work-desk', 'Desks that make working from home a pleasure.', 'হোম অফিস'],
        'lighting' => ['Lighting', 'pendant-lamp', 'Woven pendants and lamps for a warm glow.', 'আলো'],
        'decor' => ['Decor', 'jute-rug', 'Jute rugs, ceramics and the finishing touches.', 'সাজসজ্জা'],
    ],

    // The two products without a photo come first (the oldest), so the newest arrivals all have one.
    'products' => [
        'bedside-table' => ['name' => 'Two-drawer Bedside Table', 'category' => 'bedroom', 'price' => '7990',
            'variants' => ['Finish' => ['Oak', 'White']],
            'bn' => ['দুই ড্রয়ারের বেডসাইড টেবিল', 'নরম করে বন্ধ হওয়া দুই ড্রয়ারের ছোট টেবিল।'],
            'text' => 'A compact bedside table with two soft-close drawers and a solid wood top. Room for a lamp, a book and a glass of water.'],
        'table-lamp' => ['name' => 'Ceramic Table Lamp', 'category' => 'lighting', 'price' => '3490',
            'bn' => ['সিরামিকের টেবিল ল্যাম্প', 'লিনেন শেডের হাতে গড়া সিরামিক ল্যাম্প।'],
            'text' => 'A hand-thrown ceramic lamp base with a linen shade that softens the light. Bulb included.'],
        'ceramic-vase' => ['name' => 'Ceramic Vase Set (3)', 'category' => 'decor', 'price' => '1890',
            'bn' => ['সিরামিক ফুলদানি সেট (৩টি)', 'তিন মাপের ম্যাট সিরামিক ফুলদানি।'],
            'text' => 'Three matte ceramic vases in soft earth tones and different heights. Lovely with dried grasses or fresh stems.'],
        'jute-rug' => ['name' => 'Handwoven Jute Rug', 'category' => 'decor', 'price' => '5990', 'featured' => true,
            'variants' => ['Size' => ['120 × 180 cm' => ['5990', null], '160 × 230 cm' => ['8990', null]]],
            'bn' => ['হাতে বোনা পাটের রাগ', 'বাংলাদেশের সোনালি আঁশে হাতে বোনা রাগ।'],
            'text' => 'A rug handwoven from Bangladeshi jute in a chunky braid. Hard-wearing, natural and lovely under bare feet.'],
        'pendant-lamp' => ['name' => 'Woven Rattan Pendant', 'category' => 'lighting', 'price' => '4990', 'featured' => true,
            'bn' => ['বেতের ঝুলন্ত বাতি', 'বেতে বোনা ঝুলন্ত বাতি, ঘরে উষ্ণ নকশার আলো।'],
            'text' => 'A rattan pendant woven by hand that throws warm, patterned light. Fits a standard ceiling fitting.'],
        'work-desk' => ['name' => 'Solid Wood Work Desk', 'category' => 'home-office', 'price' => '21990', 'featured' => true,
            'variants' => ['Finish' => ['Oak' => ['21990', null], 'Walnut' => ['23990', null]]],
            'bn' => ['কাঠের কাজের ডেস্ক', 'ড্রয়ারসহ মজবুত কাঠের ডেস্ক, বাড়ির অফিসের জন্য।'],
            'text' => 'A 120 cm desk in solid wood with a slim drawer and a cable hole. Sturdy enough for two screens.'],
        'dining-chair' => ['name' => 'Cushioned Dining Chair', 'category' => 'dining', 'price' => '8990', 'sale' => '7490',
            'variants' => ['Finish' => ['Oak', 'Walnut']],
            'bn' => ['গদিওয়ালা ডাইনিং চেয়ার', 'নরম গদির আসন আর মজবুত কাঠের চেয়ার।'],
            'text' => 'A solid wood dining chair with a padded linen seat and a clean, straight back. Comfortable through long meals.'],
        'dining-table' => ['name' => 'Solid Wood Dining Table', 'category' => 'dining', 'price' => '39990', 'featured' => true,
            'variants' => ['Size' => ['4-seat' => ['39990', null], '6-seat' => ['54990', '49990']]],
            'bn' => ['কাঠের ডাইনিং টেবিল', 'পরিবারের দীর্ঘ খাবারের জন্য মজবুত কাঠের টেবিল।'],
            'text' => 'A dining table in solid wood with rounded corners and an oiled finish that gets better with age.'],
        'platform-bed' => ['name' => 'Low Platform Bed', 'category' => 'bedroom', 'price' => '45990',
            'variants' => ['Size' => ['Queen' => ['45990', null], 'King' => ['52990', null]]],
            'bn' => ['নিচু প্ল্যাটফর্ম খাট', 'নিচু, শান্ত নকশার মজবুত কাঠের খাট।'],
            'text' => 'A low platform bed in solid wood with a slatted base, so no box spring is needed. Assembled at home by our team.'],
        'coffee-table' => ['name' => 'Round Coffee Table', 'category' => 'living-room', 'price' => '14990',
            'variants' => ['Finish' => ['Oak' => ['14990', '12990'], 'Walnut' => ['16990', null]]],
            'bn' => ['গোল কফি টেবিল', 'নরম কোণের গোল কাঠের কফি টেবিল।'],
            'text' => 'A round coffee table with a solid wood top and splayed legs. No sharp corners, so it is kind to knees.'],
        'accent-armchair' => ['name' => 'Accent Armchair', 'category' => 'living-room', 'price' => '24990', 'featured' => true,
            'bn' => ['অ্যাকসেন্ট আর্মচেয়ার', 'পড়ার কোণের জন্য নরম গদির আর্মচেয়ার।'],
            'text' => 'A deep, comfortable armchair with a solid wood frame and a soft woven cover. Made for a reading corner.'],
        'three-seater-sofa' => ['name' => 'Three-seater Linen Sofa', 'category' => 'living-room', 'price' => '64990', 'sale' => '57990', 'featured' => true,
            'variants' => ['Colour' => ['Oatmeal', 'Sage']],
            'bn' => ['তিন আসনের লিনেন সোফা', 'খোলা যায় এমন লিনেন কভারের গভীর আরামদায়ক সোফা।'],
            'text' => 'A deep three-seater with feather-wrapped cushions and a removable linen-blend cover. Built on a solid wood frame.'],
    ],

    // Banners reuse the product photos (`image`).
    'banners' => [
        'banner-hero-1' => ['image' => 'three-seater-sofa', 'placement' => 'hero_slider', 'name' => 'Living room', 'kicker' => 'Made in Bangladesh',
            'title' => 'Furniture for slow evenings', 'subtitle' => 'Solid wood and natural fabrics, delivered and assembled at home.',
            'button_label' => 'Shop living room', 'link_url' => '/category/living-room', 'secondary_button_label' => 'Our workshop', 'secondary_link_url' => '/pages/about-us',
            'text_color' => '#ffffff', 'text_position' => 'left',
            'bn' => ['kicker' => 'বাংলাদেশে তৈরি', 'title' => 'ধীর সন্ধ্যার আসবাব', 'subtitle' => 'খাঁটি কাঠ আর প্রাকৃতিক কাপড়, বাড়িতে পৌঁছে জোড়া লাগিয়ে দেওয়া হয়।', 'button_label' => 'বসার ঘর', 'secondary_button_label' => 'আমাদের কারখানা']],
        'banner-hero-2' => ['image' => 'dining-table', 'placement' => 'hero_slider', 'name' => 'Dining', 'kicker' => 'Up to 10 % off',
            'title' => 'Gather round the table', 'subtitle' => 'Dining tables and chairs for long family meals.',
            'button_label' => 'Shop dining', 'link_url' => '/category/dining', 'text_color' => '#ffffff', 'text_position' => 'left',
            'bn' => ['kicker' => '১০ % পর্যন্ত ছাড়', 'title' => 'টেবিল ঘিরে সবাই', 'subtitle' => 'পরিবারের দীর্ঘ খাবারের জন্য ডাইনিং টেবিল আর চেয়ার।', 'button_label' => 'ডাইনিং দেখুন']],
        'banner-bedroom' => ['image' => 'platform-bed', 'placement' => 'home_promo', 'name' => 'Bedroom', 'kicker' => 'Bedroom',
            'title' => 'Calm nights start here', 'button_label' => 'Shop bedroom', 'link_url' => '/category/bedroom', 'text_color' => '#ffffff',
            'bn' => ['kicker' => 'শোবার ঘর', 'title' => 'শান্ত রাতের শুরু এখানে', 'button_label' => 'দেখুন']],
        'banner-office' => ['image' => 'work-desk', 'placement' => 'home_promo', 'name' => 'Home office', 'kicker' => 'Home office',
            'title' => 'A desk you will love', 'button_label' => 'Shop desks', 'link_url' => '/category/home-office', 'text_color' => '#ffffff',
            'bn' => ['kicker' => 'হোম অফিস', 'title' => 'পছন্দের একটি ডেস্ক', 'button_label' => 'দেখুন']],
        'banner-lighting' => ['image' => 'pendant-lamp', 'placement' => 'home_promo', 'name' => 'Lighting', 'kicker' => 'Lighting',
            'title' => 'Warm light, woven by hand', 'button_label' => 'Shop lighting', 'link_url' => '/category/lighting', 'text_color' => '#ffffff',
            'bn' => ['kicker' => 'আলো', 'title' => 'হাতে বোনা উষ্ণ আলো', 'button_label' => 'দেখুন']],
    ],

    'theme' => [
        'announcement' => ['text' => 'Free delivery and assembly in Dhaka over ৳20,000 · 1-year warranty on all furniture', 'background' => '#2f4a3a', 'foreground' => '#ffffff'],
        'footer' => [
            'about' => 'Kath & Home makes solid wood furniture in our Tejgaon workshop and sources decor from Bangladeshi makers.',
            'copyright' => '© Kath & Home (demo store). All rights reserved.',
            'contact' => ['email' => 'hello@kathandhome.test', 'phone' => '01700-000009', 'address' => 'Workshop 4, Tejgaon Industrial Area, Dhaka 1208'],
            'social' => ['facebook' => 'https://facebook.example/kathandhome', 'instagram' => 'https://instagram.example/kathandhome', 'youtube' => 'https://youtube.example/kathandhome'],
        ],
    ],

    'pages' => [
        'about' => ['title' => 'About us', 'bn' => 'আমাদের কথা', 'body' => '<h2>Made in our workshop</h2><p>Kath & Home began in 2016 with two carpenters and one bench in Tejgaon. Today a team of twelve makes every table, bed and desk by hand from seasoned wood.</p><p>We deliver and assemble at your home, and we stand behind every joint with a one-year warranty.</p>'],
        'contact' => ['title' => 'Contact us', 'bn' => 'যোগাযোগ করুন', 'body' => '<p>Want to see a finish, measure a room or ask about delivery? Call 01700-000009, 10 am to 7 pm, or visit the workshop.</p>'],
        'faq' => ['title' => 'Frequently asked questions', 'bn' => 'সাধারণ জিজ্ঞাসা', 'body' => '<p>Can not find your answer? Our team is happy to help from the contact page.</p>'],
        'privacy' => ['title' => 'Privacy policy', 'body' => '<h2>What we keep</h2><p>Your name, contact details, address and orders, used to deliver, assemble and look after your furniture.</p><h2>Your choices</h2><p>We never sell your details. You can update them in your account at any time.</p>'],
        'terms' => ['title' => 'Terms of service', 'body' => '<h2>Warranty</h2><p>All furniture has a one-year warranty on frames and joints from the delivery date.</p><h2>Returns</h2><p>Decor can be returned within 7 days. Furniture made to order can not be returned unless it is faulty.</p>'],
    ],
    'faq' => [
        ['Delivery', 'Do you assemble the furniture?', '<p>Yes. Our team delivers and assembles every piece inside Dhaka at no extra cost.</p>'],
        ['Delivery', 'How long does delivery take?', '<p>Pieces in stock arrive in 3–5 days; made-to-order pieces in 2–3 weeks.</p>'],
        ['Care', 'How do I care for solid wood?', '<p>Wipe with a dry cloth, keep it out of direct sun and re-oil the surface once a year.</p>'],
        [null, 'Can I see the finishes first?', '<p>Of course. Visit the workshop in Tejgaon or ask us for photos of each finish.</p>'],
    ],
    'blog' => [
        'category' => ['Home notes', 'home-notes', 'Room ideas, wood care and news from the Kath & Home workshop.'],
        'posts' => [
            ['caring-for-solid-wood', 'Caring for solid wood', 'A dry cloth, a little oil once a year and no direct sun.', 'coffee-table', 4,
                '<p>Solid wood moves with the seasons. Keep it away from heaters and direct sun.</p><p>Once a year, rub in a little furniture oil with a soft cloth.</p>',
                ['title' => 'খাঁটি কাঠের যত্ন', 'excerpt' => 'শুকনো কাপড়, বছরে একবার একটু তেল, আর সরাসরি রোদ নয়।']],
            ['small-living-room-ideas', 'Ideas for a small living room', 'Round tables, raised legs and one good rug make a room feel bigger.', 'jute-rug', 12,
                '<p>Furniture on legs shows more floor and makes a room feel larger.</p><p>A round coffee table and a light rug keep the space easy to move around.</p>',
                ['title' => 'ছোট বসার ঘরের জন্য কিছু ভাবনা', 'excerpt' => 'গোল টেবিল, উঁচু পা আর একটি ভালো রাগে ঘর বড় দেখায়।']],
            ['inside-the-workshop', 'Inside our workshop', 'How a dining table is made, from plank to oiled finish.', 'dining-table', 20,
                '<p>Every table starts as seasoned planks, glued, planed and joined by hand.</p><p>It takes about a week, finished with three coats of oil.</p>',
                ['title' => 'আমাদের কারখানার ভেতরে', 'excerpt' => 'তক্তা থেকে তেলের ফিনিশ পর্যন্ত একটি ডাইনিং টেবিল যেভাবে তৈরি হয়।']],
        ],
    ],
    'testimonials' => [
        ['quote' => 'The dining table is beautiful and solid. The team assembled it in twenty minutes and cleaned up after.', 'name' => 'Shamima K.', 'role' => 'Bashundhara', 'rating' => 5],
        ['quote' => 'Our sofa is deep and comfortable, and the linen cover washes well.', 'name' => 'Faisal R.', 'role' => 'Gulshan', 'rating' => 5],
        ['quote' => 'Lovely jute rug. Delivery took a little longer than promised, but it was worth the wait.', 'name' => 'Nusrat J.', 'role' => 'Chattogram', 'rating' => 4],
    ],
    'reviewers' => [
        ['name' => 'Shamima Khan', 'email' => 'shamima@kathandhome.test', 'phone' => '01700000091', 'area' => 'Bashundhara', 'reviews' => [
            ['dining-table', 5, 'Solid and beautiful', 'Heavy, well made and the oiled finish is lovely to touch.'],
            ['dining-chair', 4, 'Comfortable chairs', 'The padded seat is comfortable. Slightly lighter colour than the photo.'],
            ['pendant-lamp', 5, 'Gorgeous light', 'Throws a lovely pattern on the ceiling in the evening.'],
        ]],
        ['name' => 'Faisal Rahman', 'email' => 'faisal@kathandhome.test', 'phone' => '01700000092', 'area' => 'Gulshan', 'reviews' => [
            ['three-seater-sofa', 5, 'So comfortable', 'Deep seats and soft cushions. The oatmeal colour is perfect.'],
            ['coffee-table', 4, 'Nice table', 'Good size for our room. One leg needed tightening after a week.'],
        ]],
        ['name' => 'Nusrat Jahan', 'email' => 'nusrat@kathandhome.test', 'phone' => '01700000093', 'area' => 'Mirpur', 'reviews' => [
            ['jute-rug', 4, 'Natural and sturdy', 'Lovely texture. It sheds a little at first, as jute does.'],
            ['ceramic-vase', 5, 'Beautiful set', 'Soft colours and a nice weight. Great with dried flowers.'],
        ]],
    ],

    // P1b: answered shopper questions (DemoProductPageSeeder): [product, name, e-mail, language, question, answer].
    'questions' => [
        ['three-seater-sofa', 'Tanzila Ahmed', 'tanzila@kathandhome.test', 'en', 'Can the cover be washed?', 'Yes, the linen-blend cover zips off and can be washed cold on a gentle cycle.'],
        ['dining-table', 'জাহিদ হাসান', 'zahid@kathandhome.test', 'bn', 'কোন কাঠ ব্যবহার করা হয়?', 'শুকানো মেহগনি ও সেগুন কাঠ, প্রাকৃতিক তেলের ফিনিশসহ।'],
    ],

    'features' => [
        ['icon' => 'truck', 'title' => 'Delivery and assembly', 'text' => 'Free in Dhaka over ৳20,000'],
        ['icon' => 'shield-check', 'title' => '1-year warranty', 'text' => 'On frames and joints'],
        ['icon' => 'credit-card', 'title' => 'Cash on delivery', 'text' => 'Or bank transfer'],
        ['icon' => 'store', 'title' => 'Visit the workshop', 'text' => 'Tejgaon, 10 am to 7 pm'],
    ],
    'rich_text' => [
        'title' => 'Made by hand in Tejgaon',
        'body' => '<p>Every table, bed and desk is made by our carpenters from seasoned wood, then delivered and assembled at your home. Read <a href="/pages/about-us">our story</a> or see the <a href="/pages/faq">FAQ</a>.</p>',
        'bn' => ['title' => 'তেজগাঁওয়ে হাতে তৈরি', 'body_html' => '<p>প্রতিটি টেবিল, খাট আর ডেস্ক আমাদের কাঠমিস্ত্রিরা শুকানো কাঠ দিয়ে তৈরি করেন, তারপর বাড়িতে পৌঁছে জোড়া লাগিয়ে দেন। পড়ুন <a href="/pages/about-us">আমাদের গল্প</a> অথবা দেখুন <a href="/pages/faq">প্রশ্নোত্তর</a>।</p>'],
    ],
    'newsletter' => ['background' => '#2f4a3a', 'foreground' => '#ffffff', 'image' => 'ceramic-vase'],
    'sections' => [
        ['type' => 'hero_slider', 'banners' => ['banner-hero-1', 'banner-hero-2']],
        ['type' => 'category_strip', 'title' => 'Shop by room', 'categories' => ['living-room', 'bedroom', 'dining', 'home-office', 'lighting', 'decor'],
            'bn' => ['title' => 'ঘর অনুযায়ী কিনুন']],
        ['type' => 'product_grid', 'title' => 'New arrivals', 'subtitle' => 'Fresh from the workshop', 'config' => ['source' => 'new_arrivals', 'limit' => 8, 'columns' => 4, 'view_all_url' => '/shop'],
            'bn' => ['title' => 'নতুন এসেছে', 'subtitle' => 'কারখানা থেকে সদ্য']],
        ['type' => 'banner_grid', 'banners' => ['banner-bedroom', 'banner-office', 'banner-lighting'], 'config' => ['layout' => '3-col']],
        ['type' => 'rich_text'],
        ['type' => 'hot_deals', 'title' => 'Home week', 'subtitle' => '10 % off four pieces', 'config' => ['limit' => 4, 'view_all_url' => '/shop'],
            'bn' => ['title' => 'হোম সপ্তাহ', 'subtitle' => 'চারটি পণ্যে ১০ % ছাড়']],
        ['type' => 'product_carousel', 'title' => 'Most loved', 'subtitle' => 'Pieces our customers come back for', 'config' => ['source' => 'best_sellers', 'limit' => 8, 'view_all_url' => '/shop'],
            'bn' => ['title' => 'সবচেয়ে প্রিয়', 'subtitle' => 'ক্রেতারা বারবার যা কেনেন']],
        ['type' => 'features_strip', 'features' => true],
        ['type' => 'testimonials', 'title' => 'In our customers\' homes', 'bn' => ['title' => 'ক্রেতাদের ঘরে']],
        ['type' => 'blog_posts', 'title' => 'Home notes', 'config' => ['limit' => 3, 'view_all_url' => '/blog'], 'bn' => ['title' => 'ঘরের কথা']],
        ['type' => 'newsletter', 'title' => 'Letters from the workshop', 'config' => ['text' => 'New pieces, care tips and workshop news, once a month. Unsubscribe any time.', 'button_label' => 'Subscribe'],
            'bn' => ['title' => 'কারখানা থেকে চিঠি', 'text' => 'নতুন পণ্য, যত্নের টিপস আর কারখানার খবর, মাসে একবার। যেকোনো সময় বন্ধ করা যায়।', 'button_label' => 'সাবস্ক্রাইব']],
    ],
];
