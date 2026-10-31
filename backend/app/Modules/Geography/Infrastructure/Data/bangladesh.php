<?php

/*
 * Administrative divisions and districts of Bangladesh (8 divisions, 64 districts).
 *
 * English names follow the spellings the Government of Bangladesh adopted in 2018
 * (Barishal, Chattogram, Cumilla, Jashore, Bogura); Bangla names are the official ones.
 * Codes are the Bangladesh Bureau of Statistics (BBS) geocodes. Public facts, bundled so
 * the reference data needs no third-party download.
 *
 * Ids are fixed (divisions 1–8, districts 1–64) so addresses keep their meaning when the
 * data is reseeded.
 *
 * @return list<array{id: int, code: string, name_en: string, name_bn: string, districts: list<array{id: int, code: string, name_en: string, name_bn: string}>}>
 */
return [
    ['id' => 1, 'code' => '10', 'name_en' => 'Barishal', 'name_bn' => 'বরিশাল', 'districts' => [
        ['id' => 1, 'code' => '04', 'name_en' => 'Barguna', 'name_bn' => 'বরগুনা'],
        ['id' => 2, 'code' => '06', 'name_en' => 'Barishal', 'name_bn' => 'বরিশাল'],
        ['id' => 3, 'code' => '09', 'name_en' => 'Bhola', 'name_bn' => 'ভোলা'],
        ['id' => 4, 'code' => '42', 'name_en' => 'Jhalakathi', 'name_bn' => 'ঝালকাঠি'],
        ['id' => 5, 'code' => '78', 'name_en' => 'Patuakhali', 'name_bn' => 'পটুয়াখালী'],
        ['id' => 6, 'code' => '79', 'name_en' => 'Pirojpur', 'name_bn' => 'পিরোজপুর'],
    ]],
    ['id' => 2, 'code' => '20', 'name_en' => 'Chattogram', 'name_bn' => 'চট্টগ্রাম', 'districts' => [
        ['id' => 7, 'code' => '03', 'name_en' => 'Bandarban', 'name_bn' => 'বান্দরবান'],
        ['id' => 8, 'code' => '12', 'name_en' => 'Brahmanbaria', 'name_bn' => 'ব্রাহ্মণবাড়িয়া'],
        ['id' => 9, 'code' => '13', 'name_en' => 'Chandpur', 'name_bn' => 'চাঁদপুর'],
        ['id' => 10, 'code' => '15', 'name_en' => 'Chattogram', 'name_bn' => 'চট্টগ্রাম'],
        ['id' => 11, 'code' => '22', 'name_en' => 'Cox\'s Bazar', 'name_bn' => 'কক্সবাজার'],
        ['id' => 12, 'code' => '19', 'name_en' => 'Cumilla', 'name_bn' => 'কুমিল্লা'],
        ['id' => 13, 'code' => '30', 'name_en' => 'Feni', 'name_bn' => 'ফেনী'],
        ['id' => 14, 'code' => '46', 'name_en' => 'Khagrachhari', 'name_bn' => 'খাগড়াছড়ি'],
        ['id' => 15, 'code' => '51', 'name_en' => 'Lakshmipur', 'name_bn' => 'লক্ষ্মীপুর'],
        ['id' => 16, 'code' => '75', 'name_en' => 'Noakhali', 'name_bn' => 'নোয়াখালী'],
        ['id' => 17, 'code' => '84', 'name_en' => 'Rangamati', 'name_bn' => 'রাঙ্গামাটি'],
    ]],
    ['id' => 3, 'code' => '30', 'name_en' => 'Dhaka', 'name_bn' => 'ঢাকা', 'districts' => [
        ['id' => 18, 'code' => '26', 'name_en' => 'Dhaka', 'name_bn' => 'ঢাকা'],
        ['id' => 19, 'code' => '29', 'name_en' => 'Faridpur', 'name_bn' => 'ফরিদপুর'],
        ['id' => 20, 'code' => '33', 'name_en' => 'Gazipur', 'name_bn' => 'গাজীপুর'],
        ['id' => 21, 'code' => '35', 'name_en' => 'Gopalganj', 'name_bn' => 'গোপালগঞ্জ'],
        ['id' => 22, 'code' => '48', 'name_en' => 'Kishoreganj', 'name_bn' => 'কিশোরগঞ্জ'],
        ['id' => 23, 'code' => '54', 'name_en' => 'Madaripur', 'name_bn' => 'মাদারীপুর'],
        ['id' => 24, 'code' => '56', 'name_en' => 'Manikganj', 'name_bn' => 'মানিকগঞ্জ'],
        ['id' => 25, 'code' => '59', 'name_en' => 'Munshiganj', 'name_bn' => 'মুন্সিগঞ্জ'],
        ['id' => 26, 'code' => '67', 'name_en' => 'Narayanganj', 'name_bn' => 'নারায়ণগঞ্জ'],
        ['id' => 27, 'code' => '68', 'name_en' => 'Narsingdi', 'name_bn' => 'নরসিংদী'],
        ['id' => 28, 'code' => '82', 'name_en' => 'Rajbari', 'name_bn' => 'রাজবাড়ী'],
        ['id' => 29, 'code' => '86', 'name_en' => 'Shariatpur', 'name_bn' => 'শরীয়তপুর'],
        ['id' => 30, 'code' => '93', 'name_en' => 'Tangail', 'name_bn' => 'টাঙ্গাইল'],
    ]],
    ['id' => 4, 'code' => '40', 'name_en' => 'Khulna', 'name_bn' => 'খুলনা', 'districts' => [
        ['id' => 31, 'code' => '01', 'name_en' => 'Bagerhat', 'name_bn' => 'বাগেরহাট'],
        ['id' => 32, 'code' => '18', 'name_en' => 'Chuadanga', 'name_bn' => 'চুয়াডাঙ্গা'],
        ['id' => 33, 'code' => '41', 'name_en' => 'Jashore', 'name_bn' => 'যশোর'],
        ['id' => 34, 'code' => '44', 'name_en' => 'Jhenaidah', 'name_bn' => 'ঝিনাইদহ'],
        ['id' => 35, 'code' => '47', 'name_en' => 'Khulna', 'name_bn' => 'খুলনা'],
        ['id' => 36, 'code' => '50', 'name_en' => 'Kushtia', 'name_bn' => 'কুষ্টিয়া'],
        ['id' => 37, 'code' => '55', 'name_en' => 'Magura', 'name_bn' => 'মাগুরা'],
        ['id' => 38, 'code' => '57', 'name_en' => 'Meherpur', 'name_bn' => 'মেহেরপুর'],
        ['id' => 39, 'code' => '65', 'name_en' => 'Narail', 'name_bn' => 'নড়াইল'],
        ['id' => 40, 'code' => '87', 'name_en' => 'Satkhira', 'name_bn' => 'সাতক্ষীরা'],
    ]],
    ['id' => 5, 'code' => '45', 'name_en' => 'Mymensingh', 'name_bn' => 'ময়মনসিংহ', 'districts' => [
        ['id' => 41, 'code' => '39', 'name_en' => 'Jamalpur', 'name_bn' => 'জামালপুর'],
        ['id' => 42, 'code' => '61', 'name_en' => 'Mymensingh', 'name_bn' => 'ময়মনসিংহ'],
        ['id' => 43, 'code' => '72', 'name_en' => 'Netrokona', 'name_bn' => 'নেত্রকোণা'],
        ['id' => 44, 'code' => '89', 'name_en' => 'Sherpur', 'name_bn' => 'শেরপুর'],
    ]],
    ['id' => 6, 'code' => '50', 'name_en' => 'Rajshahi', 'name_bn' => 'রাজশাহী', 'districts' => [
        ['id' => 45, 'code' => '10', 'name_en' => 'Bogura', 'name_bn' => 'বগুড়া'],
        ['id' => 46, 'code' => '70', 'name_en' => 'Chapainawabganj', 'name_bn' => 'চাঁপাইনবাবগঞ্জ'],
        ['id' => 47, 'code' => '38', 'name_en' => 'Joypurhat', 'name_bn' => 'জয়পুরহাট'],
        ['id' => 48, 'code' => '64', 'name_en' => 'Naogaon', 'name_bn' => 'নওগাঁ'],
        ['id' => 49, 'code' => '69', 'name_en' => 'Natore', 'name_bn' => 'নাটোর'],
        ['id' => 50, 'code' => '76', 'name_en' => 'Pabna', 'name_bn' => 'পাবনা'],
        ['id' => 51, 'code' => '81', 'name_en' => 'Rajshahi', 'name_bn' => 'রাজশাহী'],
        ['id' => 52, 'code' => '88', 'name_en' => 'Sirajganj', 'name_bn' => 'সিরাজগঞ্জ'],
    ]],
    ['id' => 7, 'code' => '55', 'name_en' => 'Rangpur', 'name_bn' => 'রংপুর', 'districts' => [
        ['id' => 53, 'code' => '27', 'name_en' => 'Dinajpur', 'name_bn' => 'দিনাজপুর'],
        ['id' => 54, 'code' => '32', 'name_en' => 'Gaibandha', 'name_bn' => 'গাইবান্ধা'],
        ['id' => 55, 'code' => '49', 'name_en' => 'Kurigram', 'name_bn' => 'কুড়িগ্রাম'],
        ['id' => 56, 'code' => '52', 'name_en' => 'Lalmonirhat', 'name_bn' => 'লালমনিরহাট'],
        ['id' => 57, 'code' => '73', 'name_en' => 'Nilphamari', 'name_bn' => 'নীলফামারী'],
        ['id' => 58, 'code' => '77', 'name_en' => 'Panchagarh', 'name_bn' => 'পঞ্চগড়'],
        ['id' => 59, 'code' => '85', 'name_en' => 'Rangpur', 'name_bn' => 'রংপুর'],
        ['id' => 60, 'code' => '94', 'name_en' => 'Thakurgaon', 'name_bn' => 'ঠাকুরগাঁও'],
    ]],
    ['id' => 8, 'code' => '60', 'name_en' => 'Sylhet', 'name_bn' => 'সিলেট', 'districts' => [
        ['id' => 61, 'code' => '36', 'name_en' => 'Habiganj', 'name_bn' => 'হবিগঞ্জ'],
        ['id' => 62, 'code' => '58', 'name_en' => 'Moulvibazar', 'name_bn' => 'মৌলভীবাজার'],
        ['id' => 63, 'code' => '90', 'name_en' => 'Sunamganj', 'name_bn' => 'সুনামগঞ্জ'],
        ['id' => 64, 'code' => '91', 'name_en' => 'Sylhet', 'name_bn' => 'সিলেট'],
    ]],
];
