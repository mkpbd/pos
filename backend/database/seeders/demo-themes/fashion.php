<?php

/**
 * Loom & Lane — the fashion preset demo store (DemoThemesSeeder, B11). Same shape as vegan.php,
 * plus Bangla (`bangla`, `bn` texts) and banners that reuse the product photos (`image`). Ten
 * photos: the T-shirt and the belt have none. Names, copy and photos are our own (photo credits
 * in images/manifest.json).
 */
return [
    'name' => 'Loom & Lane',
    'host' => 'fashion.shop.localhost',
    'preset' => 'fashion',
    'bangla' => true,
    'owner' => ['name' => 'Farzana Kabir', 'email' => 'owner@fashion.test'],
    'branch' => 'Loom & Lane Gulshan',
    'sku' => 'LL',
    'meta_description' => 'Dresses, shirts, kurtis, handloom sarees, shoes and bags from Loom & Lane, a Dhaka fashion boutique delivering across Bangladesh.',
    'free_delivery_over' => '3000.00',
    'coupon' => ['code' => 'STYLE15', 'name' => 'Style 15', 'description' => '15% off orders over ৳4,000 with code STYLE15', 'percent' => '15', 'min' => '4000'],
    'flash_sale' => [
        'name' => 'Weekend edit', 'description' => '20% off four favourites this weekend only',
        'percent' => '20', 'days' => 3, 'products' => ['bomber-jacket', 'handloom-saree', 'leather-loafers', 'silk-scarf'],
    ],
    'out_of_stock' => 'leather-belt',
    // Sold at the shop counter (POS): the best sellers.
    'best_sellers' => ['linen-shirt' => 6, 'wrap-midi-dress' => 5, 'block-print-kurti' => 4, 'leather-satchel' => 3, 'block-heel-sandals' => 3, 'pleated-skirt' => 2],
    'swatches' => ['Colour' => ['White' => '#ffffff', 'Black' => '#111111', 'Navy' => '#1e3a5f']],

    // slug => [name, photo, description, Bangla name]
    'categories' => [
        'women' => ['Women', 'wrap-midi-dress', 'Dresses, skirts and easy everyday pieces in breathable fabrics.', 'নারী'],
        'men' => ['Men', 'linen-shirt', 'Linen shirts, jackets and T-shirts for warm days and cool evenings.', 'পুরুষ'],
        'ethnic' => ['Ethnic wear', 'block-print-kurti', 'Block-print kurtis and handloom sarees woven in Bangladesh.', 'দেশি পোশাক'],
        'shoes' => ['Shoes', 'leather-loafers', 'Leather loafers and block-heel sandals in full sizes.', 'জুতা'],
        'bags' => ['Bags', 'leather-satchel', 'Leather satchels for work, weekends and everything between.', 'ব্যাগ'],
        'accessories' => ['Accessories', 'silk-scarf', 'Silk scarves and leather belts to finish the look.', 'অ্যাকসেসরিজ'],
    ],

    // The two products without a photo come first (the oldest), so the newest arrivals all have one.
    'products' => [
        'cotton-tshirt' => ['name' => 'Essential Cotton T-shirt', 'category' => 'men', 'price' => '790',
            'variants' => ['Colour' => ['White', 'Black', 'Navy']],
            'bn' => ['এসেনশিয়াল সুতি টি-শার্ট', 'ভারী সুতির টি-শার্ট, ধোয়ার পরও আকার ঠিক থাকে।'],
            'text' => 'A heavyweight cotton T-shirt that keeps its shape wash after wash. Ribbed collar and a regular fit.'],
        'leather-belt' => ['name' => 'Braided Leather Belt', 'category' => 'accessories', 'price' => '1190',
            'variants' => ['Size' => ['32', '34', '36']],
            'bn' => ['বেণি করা চামড়ার বেল্ট', 'হাতে বোনা চামড়ার বেল্ট, ব্রাশ করা ধাতব বাকল।'],
            'text' => 'A hand-braided leather belt with a brushed metal buckle. The braid lets you fasten it at any length.'],
        'pleated-skirt' => ['name' => 'Pleated Midi Skirt', 'category' => 'women', 'price' => '2290', 'featured' => true,
            'variants' => ['Size' => ['S', 'M', 'L']],
            'bn' => ['প্লিটেড মিডি স্কার্ট', 'হাঁটার সঙ্গে দোলে এমন নরম প্লিটের মিডি স্কার্ট।'],
            'text' => 'A mint midi skirt with soft knife pleats that move as you walk. Elastic at the back of the waist for comfort.'],
        'linen-shirt' => ['name' => 'Linen Band-collar Shirt', 'category' => 'men', 'price' => '2190', 'sale' => '1790', 'featured' => true,
            'variants' => ['Size' => ['S', 'M', 'L', 'XL']],
            'bn' => ['লিনেন ব্যান্ড-কলার শার্ট', 'গরমের দিনের জন্য হালকা, বাতাস চলাচলে ভালো লিনেন শার্ট।'],
            'text' => 'A light linen shirt with a band collar and short sleeves. Breathable on the hottest days and better with every wash.'],
        'bomber-jacket' => ['name' => 'Lightweight Bomber Jacket', 'category' => 'men', 'price' => '4290',
            'variants' => ['Size' => ['M', 'L', 'XL']],
            'bn' => ['হালকা বোম্বার জ্যাকেট', 'শীতের সন্ধ্যার জন্য হালকা বোম্বার জ্যাকেট।'],
            'text' => 'A rust-coloured bomber jacket in a light water-repellent shell. Ribbed cuffs and two deep pockets.'],
        'wrap-midi-dress' => ['name' => 'Polka Dot Wrap Dress', 'category' => 'women', 'price' => '3490', 'sale' => '2790', 'featured' => true,
            'variants' => ['Size' => ['S', 'M', 'L']],
            'bn' => ['পোলকা ডট র‍্যাপ ড্রেস', 'কোমরে বাঁধা যায় এমন হালকা পোলকা ডট মিডি ড্রেস।'],
            'text' => 'A flowing midi wrap dress with a bold polka dot print and a tie waist. Light viscose that stays cool all day.'],
        'block-print-kurti' => ['name' => 'Block-print Cotton Kurti', 'category' => 'ethnic', 'price' => '1890', 'sale' => '1590', 'featured' => true,
            'variants' => ['Size' => ['S', 'M', 'L']],
            'bn' => ['ব্লক প্রিন্ট সুতি কুর্তি', 'হাতে ব্লক প্রিন্ট করা নরম সুতির কুর্তি।'],
            'text' => 'A navy cotton kurti hand block-printed with a coral motif. A gathered waist and full sleeves for everyday wear.'],
        'handloom-saree' => ['name' => 'Handloom Cotton Saree', 'category' => 'ethnic', 'price' => '4590', 'featured' => true,
            'bn' => ['তাঁতের সুতি শাড়ি', 'বাংলাদেশের তাঁতে বোনা নরম সুতির শাড়ি।'],
            'text' => 'A soft cotton saree woven on a handloom in red and green with small woven motifs. Comes with an unstitched blouse piece.'],
        'leather-loafers' => ['name' => 'Leather Penny Loafers', 'category' => 'shoes', 'price' => '4990',
            'variants' => ['Size' => ['40', '41', '42', '43']],
            'bn' => ['চামড়ার পেনি লোফার', 'নরম চামড়ার লোফার, অফিস ও উৎসব দুটোতেই মানায়।'],
            'text' => 'Classic penny loafers in polished brown leather with a cushioned insole. Smart for the office, easy for the weekend.'],
        'block-heel-sandals' => ['name' => 'Block-heel Sandals', 'category' => 'shoes', 'price' => '2790', 'sale' => '2390',
            'variants' => ['Size' => ['36', '37', '38', '39']],
            'bn' => ['ব্লক হিল স্যান্ডেল', 'ঝকঝকে স্ট্র্যাপের আরামদায়ক ব্লক হিল স্যান্ডেল।'],
            'text' => 'Ankle-strap sandals with a steady block heel and a sparkling strap. Comfortable enough to dance in.'],
        'leather-satchel' => ['name' => 'Mini Leather Satchel', 'category' => 'bags', 'price' => '3990', 'featured' => true,
            'bn' => ['মিনি চামড়ার স্যাচেল', 'দুই বাকলের ছোট স্যাচেল, হাতে বা কাঁধে নেওয়া যায়।'],
            'text' => 'A small grey satchel in grained leather with two gold buckles. Carry it by the handle or on the long strap.'],
        'silk-scarf' => ['name' => 'Printed Silk Scarf', 'category' => 'accessories', 'price' => '1490',
            'bn' => ['প্রিন্টেড সিল্কের স্কার্ফ', 'পাতার নকশায় হালকা সিল্কের স্কার্ফ।'],
            'text' => 'A light silk scarf printed with yellow and green leaves. Wear it on the neck, in the hair or tied to a bag.'],
    ],

    // Banners reuse the product photos (`image`).
    'banners' => [
        'banner-hero-1' => ['image' => 'wrap-midi-dress', 'placement' => 'hero_slider', 'name' => 'New season', 'kicker' => 'NEW SEASON',
            'title' => 'Light layers for long days', 'subtitle' => 'Breezy dresses, linen shirts and easy skirts, made for Dhaka summers.',
            'button_label' => 'Shop women', 'link_url' => '/category/women', 'secondary_button_label' => 'Shop men', 'secondary_link_url' => '/category/men',
            'text_color' => '#1c1917', 'text_position' => 'left',
            'bn' => ['kicker' => 'নতুন মৌসুম', 'title' => 'লম্বা দিনের হালকা পোশাক', 'subtitle' => 'ঢাকার গরমের জন্য হালকা ড্রেস, লিনেন শার্ট আর আরামের স্কার্ট।', 'button_label' => 'নারীদের', 'secondary_button_label' => 'পুরুষদের']],
        'banner-hero-2' => ['image' => 'handloom-saree', 'placement' => 'hero_slider', 'name' => 'Handloom', 'kicker' => 'WOVEN IN BANGLADESH',
            'title' => 'Handloom, made for celebrations', 'subtitle' => 'Cotton sarees and block-print kurtis from small weaving studios.',
            'button_label' => 'Shop ethnic wear', 'link_url' => '/category/ethnic', 'text_color' => '#ffffff', 'text_position' => 'center',
            'bn' => ['kicker' => 'বাংলাদেশে বোনা', 'title' => 'উৎসবের জন্য তাঁতের পোশাক', 'subtitle' => 'ছোট তাঁতঘর থেকে সুতির শাড়ি আর ব্লক প্রিন্ট কুর্তি।', 'button_label' => 'দেশি পোশাক দেখুন']],
        'banner-women' => ['image' => 'pleated-skirt', 'placement' => 'home_promo', 'name' => 'Women', 'kicker' => 'WOMEN',
            'title' => 'Skirts that move', 'button_label' => 'Shop women', 'link_url' => '/category/women', 'text_color' => '#ffffff',
            'bn' => ['kicker' => 'নারী', 'title' => 'দোলানো স্কার্ট', 'button_label' => 'দেখুন']],
        'banner-men' => ['image' => 'bomber-jacket', 'placement' => 'home_promo', 'name' => 'Men', 'kicker' => 'MEN',
            'title' => 'Jackets for cool evenings', 'button_label' => 'Shop men', 'link_url' => '/category/men', 'text_color' => '#1c1917',
            'bn' => ['kicker' => 'পুরুষ', 'title' => 'ঠান্ডা সন্ধ্যার জ্যাকেট', 'button_label' => 'দেখুন']],
        'banner-bags' => ['image' => 'leather-satchel', 'placement' => 'home_promo', 'name' => 'Bags', 'kicker' => 'BAGS',
            'title' => 'Small bags, big days', 'button_label' => 'Shop bags', 'link_url' => '/category/bags', 'text_color' => '#1c1917',
            'bn' => ['kicker' => 'ব্যাগ', 'title' => 'ছোট ব্যাগ, বড় দিন', 'button_label' => 'দেখুন']],
    ],

    'theme' => [
        'announcement' => ['text' => 'Free delivery inside Dhaka over ৳3,000 · 7-day exchange · 15% off over ৳4,000 with STYLE15', 'background' => '#1c1917', 'foreground' => '#ffffff'],
        'footer' => [
            'about' => 'Loom & Lane is a small Dhaka boutique for everyday clothes, handloom from Bangladeshi weavers, shoes and bags.',
            'copyright' => '© Loom & Lane (demo store). All rights reserved.',
            'contact' => ['email' => 'hello@loomandlane.test', 'phone' => '01700-000005', 'address' => 'House 9, Road 104, Gulshan 2, Dhaka 1212'],
            'social' => ['facebook' => 'https://facebook.example/loomandlane', 'instagram' => 'https://instagram.example/loomandlane', 'tiktok' => 'https://tiktok.example/loomandlane'],
        ],
    ],

    'pages' => [
        'about' => ['title' => 'About us', 'bn' => 'আমাদের কথা', 'body' => '<h2>Clothes made to be worn</h2><p>Loom & Lane started in 2019 as a weekend stall in Gulshan. Today we design simple, well-cut clothes and work with handloom weavers in Tangail and Narsingdi.</p><p>We make small batches, so every piece is checked before it leaves the studio.</p>'],
        'contact' => ['title' => 'Contact us', 'bn' => 'যোগাযোগ করুন', 'body' => '<p>Need help with a size or an order? Send us a message or call 01700-000005, 10 am to 9 pm every day.</p>'],
        'faq' => ['title' => 'Frequently asked questions', 'bn' => 'সাধারণ জিজ্ঞাসা', 'body' => '<p>Still have a question? Our team is happy to help from the contact page.</p>'],
        'privacy' => ['title' => 'Privacy policy', 'body' => '<h2>Information we keep</h2><p>Your name, contact details, address and order history, used to deliver orders and handle exchanges.</p><h2>Your choices</h2><p>You can update your details in your account and unsubscribe from e-mails at any time.</p>'],
        'terms' => ['title' => 'Terms of service', 'body' => '<h2>Prices</h2><p>Sale prices are valid while stock lasts and until the end date shown.</p><h2>Exchanges</h2><p>Unworn items with tags can be exchanged or returned within 7 days of delivery.</p>'],
    ],
    'faq' => [
        ['Sizing', 'How do I choose my size?', '<p>Each product page has a size guide. Between two sizes? Choose the larger one for an easy fit.</p>'],
        ['Delivery', 'How much is delivery?', '<p>Inside Dhaka it is free on orders over ৳3,000; otherwise the fee is shown at checkout.</p>'],
        ['Exchanges', 'Can I exchange an item?', '<p>Yes, unworn items with tags can be exchanged within 7 days of delivery.</p>'],
        [null, 'Is the handloom made by hand?', '<p>Yes. Our sarees are woven on hand looms, so small irregularities are part of each piece.</p>'],
    ],
    'blog' => [
        'category' => ['Style notes', 'style-notes', 'Outfit ideas, fabric care and news from the Loom & Lane studio.'],
        'posts' => [
            ['caring-for-handloom', 'How to care for handloom cotton', 'Gentle washing keeps woven colours bright for years.', 'handloom-saree', 3,
                '<p>Wash handloom cotton separately in cold water the first few times and dry it in the shade.</p><p>Iron while slightly damp for crisp folds.</p>',
                ['title' => 'তাঁতের সুতির যত্ন যেভাবে নেবেন', 'excerpt' => 'আলতো করে ধুলে বোনা রং বহু বছর উজ্জ্বল থাকে।']],
            ['five-summer-outfits', 'Five outfits for a Dhaka summer', 'Light fabrics, loose cuts and one good pair of sandals.', 'linen-shirt', 9,
                '<p>Linen and viscose let the air through. Pair a linen shirt with chinos, or a wrap dress with sandals.</p><p>Keep colours light during the day.</p>',
                ['title' => 'ঢাকার গরমের পাঁচটি সাজ', 'excerpt' => 'হালকা কাপড়, ঢিলেঢালা কাট আর এক জোড়া ভালো স্যান্ডেল।']],
            ['one-bag-three-looks', 'One bag, three looks', 'How a small satchel works for the office, a dinner and a weekend.', 'leather-satchel', 16,
                '<p>Carry it by the handle with a shirt dress for work, on the long strap for the weekend.</p><p>A silk scarf tied to the handle makes it evening-ready.</p>',
                ['title' => 'এক ব্যাগে তিন সাজ', 'excerpt' => 'অফিস, ডিনার আর ছুটির দিনে একটি ছোট স্যাচেল।']],
        ],
    ],
    'testimonials' => [
        ['quote' => 'The wrap dress fits beautifully and the fabric stays cool all day. Already ordered a second one.', 'name' => 'Nadia R.', 'role' => 'Banani', 'rating' => 5],
        ['quote' => 'My handloom saree is even nicer in person. Packed with care and delivered in two days.', 'name' => 'Sharmin A.', 'role' => 'Chattogram', 'rating' => 5],
        ['quote' => 'Good linen shirts at a fair price. The exchange for a bigger size was easy.', 'name' => 'Imtiaz H.', 'role' => 'Mohammadpur', 'rating' => 4],
    ],
    'reviewers' => [
        ['name' => 'Nadia Rahman', 'email' => 'nadia@loomandlane.test', 'phone' => '01700000051', 'area' => 'Banani', 'reviews' => [
            ['wrap-midi-dress', 5, 'My favourite dress', 'Flowy, light and the tie waist is flattering. True to size.'],
            ['block-heel-sandals', 4, 'Comfortable heels', 'Steady heel and pretty strap. They needed one evening to soften.'],
            ['pleated-skirt', 5, 'Lovely colour', 'The mint is soft and the pleats keep their shape after washing.'],
        ]],
        ['name' => 'Sharmin Akter', 'email' => 'sharmin@loomandlane.test', 'phone' => '01700000052', 'area' => 'Dhanmondi', 'reviews' => [
            ['block-print-kurti', 5, 'Beautiful print', 'Soft cotton and the block print is even. Perfect for work.'],
            ['leather-satchel', 4, 'Small but smart', 'Fits a phone, wallet and keys. The leather feels good.'],
        ]],
        ['name' => 'Imtiaz Hossain', 'email' => 'imtiaz@loomandlane.test', 'phone' => '01700000053', 'area' => 'Mohammadpur', 'reviews' => [
            ['linen-shirt', 4, 'Cool in the heat', 'Light and breathable. It creases, as linen does.'],
            ['leather-loafers', 5, 'Great loafers', 'Comfortable from the first day and the leather shines up nicely.'],
        ]],
    ],

    // P1b: answered shopper questions (DemoProductPageSeeder): [product, name, e-mail, language, question, answer].
    'questions' => [
        ['wrap-midi-dress', 'Rumana Islam', 'rumana@loomandlane.test', 'en', 'Is the dress lined?', 'The skirt is lined; the top is a single layer of light viscose, not see-through.'],
        ['handloom-saree', 'তাহমিনা খাতুন', 'tahmina@loomandlane.test', 'bn', 'শাড়ির সঙ্গে কি ব্লাউজ পিস আছে?', 'হ্যাঁ, প্রতিটি শাড়ির সঙ্গে না-সেলাই করা একটি ব্লাউজ পিস থাকে।'],
    ],

    'features' => [
        ['icon' => 'truck', 'title' => 'Free delivery', 'text' => 'Inside Dhaka over ৳3,000'],
        ['icon' => 'rotate-ccw', 'title' => '7-day exchange', 'text' => 'Unworn, with tags'],
        ['icon' => 'credit-card', 'title' => 'Cash on delivery', 'text' => 'Or bank transfer'],
        ['icon' => 'store', 'title' => 'Visit the studio', 'text' => 'Gulshan 2, 10 am to 9 pm'],
    ],
    'rich_text' => [
        'title' => 'Woven here, worn everywhere',
        'body' => '<p>We cut our clothes in small batches in Dhaka and buy our handloom straight from weaving families. Read <a href="/pages/about-us">our story</a> or see the <a href="/pages/faq">FAQ</a>.</p>',
        'bn' => ['title' => 'এখানে বোনা, সবখানে পরা', 'body_html' => '<p>আমরা ঢাকায় অল্প অল্প করে পোশাক কাটি আর তাঁতিদের কাছ থেকে সরাসরি তাঁতের কাপড় কিনি। পড়ুন <a href="/pages/about-us">আমাদের গল্প</a> অথবা দেখুন <a href="/pages/faq">প্রশ্নোত্তর</a>।</p>'],
    ],
    'newsletter' => ['background' => '#1c1917', 'foreground' => '#ffffff', 'image' => 'block-print-kurti'],
    'sections' => [
        ['type' => 'hero_slider', 'banners' => ['banner-hero-1', 'banner-hero-2']],
        ['type' => 'category_strip', 'title' => 'Shop by category', 'categories' => ['women', 'men', 'ethnic', 'shoes', 'bags', 'accessories'],
            'bn' => ['title' => 'ক্যাটাগরি অনুযায়ী কিনুন']],
        ['type' => 'product_tabs', 'title' => 'New in', 'subtitle' => 'Fresh from the studio', 'config' => ['limit' => 8, 'tabs' => [
            ['label' => 'New arrivals', 'source' => 'new_arrivals'],
            ['label' => 'Featured', 'source' => 'featured'],
            ['label' => 'Best sellers', 'source' => 'best_sellers'],
        ]], 'bn' => ['title' => 'নতুন এসেছে', 'subtitle' => 'স্টুডিও থেকে সদ্য']],
        ['type' => 'banner_grid', 'banners' => ['banner-women', 'banner-men', 'banner-bags'], 'config' => ['layout' => '3-col']],
        ['type' => 'hot_deals', 'title' => 'The weekend edit', 'subtitle' => '20 % off four favourites', 'config' => ['limit' => 4, 'view_all_url' => '/shop'],
            'bn' => ['title' => 'সপ্তাহান্তের বাছাই', 'subtitle' => 'চারটি প্রিয় পণ্যে ২০ % ছাড়']],
        ['type' => 'rich_text'],
        ['type' => 'product_carousel', 'title' => 'Best sellers', 'subtitle' => 'What Dhaka is wearing', 'config' => ['source' => 'best_sellers', 'limit' => 8, 'view_all_url' => '/shop'],
            'bn' => ['title' => 'সবচেয়ে বেশি বিক্রি', 'subtitle' => 'ঢাকা এখন যা পরছে']],
        ['type' => 'testimonials', 'title' => 'Worn and loved', 'bn' => ['title' => 'ক্রেতারা যা বলছেন']],
        ['type' => 'blog_posts', 'title' => 'Style notes', 'config' => ['limit' => 3, 'view_all_url' => '/blog'], 'bn' => ['title' => 'স্টাইল নোট']],
        ['type' => 'newsletter', 'title' => 'Join the Loom & Lane list', 'config' => ['text' => 'New collections and members-only offers, twice a month. Unsubscribe any time.', 'button_label' => 'Subscribe'],
            'bn' => ['title' => 'লুম অ্যান্ড লেনের তালিকায় যোগ দিন', 'text' => 'নতুন কালেকশন আর সদস্যদের অফার, মাসে দুবার। যেকোনো সময় বন্ধ করা যায়।', 'button_label' => 'সাবস্ক্রাইব']],
        ['type' => 'features_strip', 'features' => true],
    ],

    // P1a (DemoVariantsSeeder): size guides with Bangla.
    'size_guides' => [
        [
            'name' => 'Clothing sizes', 'title' => 'Clothing size guide', 'categories' => ['women', 'men', 'ethnic'],
            'intro' => 'Measure over a thin T-shirt with a soft tape. Measurements are of the body, in centimetres.',
            'note' => 'Between two sizes? Choose the larger one for an easy fit.',
            'columns' => ['size' => 'Size', 'chest' => 'Chest (cm)', 'waist' => 'Waist (cm)', 'hip' => 'Hip (cm)'],
            'rows' => [
                ['size' => 'S', 'chest' => '86–91', 'waist' => '71–76', 'hip' => '88–93'],
                ['size' => 'M', 'chest' => '96–101', 'waist' => '81–86', 'hip' => '98–103'],
                ['size' => 'L', 'chest' => '106–111', 'waist' => '91–96', 'hip' => '108–113'],
                ['size' => 'XL', 'chest' => '116–121', 'waist' => '101–106', 'hip' => '118–123'],
            ],
            'bn' => [
                'title' => 'পোশাকের মাপের গাইড',
                'intro' => 'পাতলা টি-শার্টের ওপর নরম ফিতা দিয়ে মাপুন। মাপগুলো শরীরের, সেন্টিমিটারে।',
                'note' => 'দুই মাপের মাঝামাঝি হলে আরামদায়ক ফিটের জন্য বড়টি বেছে নিন।',
                'columns' => ['size' => 'মাপ', 'chest' => 'বুক (সেমি)', 'waist' => 'কোমর (সেমি)', 'hip' => 'নিতম্ব (সেমি)'],
            ],
        ],
        [
            'name' => 'Shoe sizes', 'title' => 'Shoe size guide', 'categories' => ['shoes'],
            'intro' => 'Stand on a sheet of paper, mark your heel and longest toe, and measure the distance.',
            'note' => 'Sizes follow EU sizing.',
            'columns' => ['eu' => 'EU', 'foot' => 'Foot length (cm)'],
            'rows' => [
                ['eu' => '36', 'foot' => '22.9'],
                ['eu' => '37', 'foot' => '23.6'],
                ['eu' => '38', 'foot' => '24.2'],
                ['eu' => '39', 'foot' => '24.9'],
                ['eu' => '40', 'foot' => '25.5'],
                ['eu' => '41', 'foot' => '26.2'],
                ['eu' => '42', 'foot' => '26.8'],
                ['eu' => '43', 'foot' => '27.5'],
            ],
            'bn' => [
                'title' => 'জুতার মাপের গাইড',
                'intro' => 'একটি কাগজের ওপর দাঁড়িয়ে গোড়ালি আর সবচেয়ে লম্বা আঙুল চিহ্নিত করুন, তারপর দূরত্ব মাপুন।',
                'note' => 'মাপগুলো ইউরোপীয় (EU) মাপ অনুযায়ী।',
                'columns' => ['foot' => 'পায়ের দৈর্ঘ্য (সেমি)'],
            ],
        ],
    ],
];
