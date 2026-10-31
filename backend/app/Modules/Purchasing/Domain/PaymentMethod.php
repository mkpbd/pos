<?php

namespace App\Modules\Purchasing\Domain;

enum PaymentMethod: string
{
    case Cash = 'cash';
    case BankTransfer = 'bank_transfer';
    case MobileBanking = 'mobile_banking';
    case Cheque = 'cheque';
    case Card = 'card';
    case Other = 'other';
}
