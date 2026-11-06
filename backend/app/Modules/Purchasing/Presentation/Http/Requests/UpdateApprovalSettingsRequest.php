<?php

namespace App\Modules\Purchasing\Presentation\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class UpdateApprovalSettingsRequest extends FormRequest
{
    public function rules(): array
    {
        return [
            'auto_approve_limit' => ['sometimes', 'required', 'decimal:0,2', 'min:0', 'max:9999999999999999'],
            'manager_limit' => ['sometimes', 'required', 'decimal:0,2', 'min:0', 'max:9999999999999999'],
            'require_po_approval' => ['sometimes', 'required', 'boolean'],
        ];
    }
}
