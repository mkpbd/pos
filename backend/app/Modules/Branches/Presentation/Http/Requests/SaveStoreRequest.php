<?php

namespace App\Modules\Branches\Presentation\Http\Requests;

use App\Modules\Branches\Domain\StoreType;
use App\Modules\Branches\Infrastructure\Models\Branch;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class SaveStoreRequest extends FormRequest
{
    public function rules(): array
    {
        $required = $this->isMethod('POST') ? 'required' : 'sometimes';
        /** @var Branch $branch */
        $branch = $this->route('branch');

        return [
            'code' => [
                $required, 'string', 'max:20', 'regex:/^[A-Za-z0-9\-_]+$/',
                Rule::unique('stores', 'code')->where('branch_id', $branch->id)->ignore($this->route('store')),
            ],
            'name' => [$required, 'string', 'max:255'],
            'type' => [$required, Rule::enum(StoreType::class)],
            'is_active' => ['sometimes', 'boolean'],
        ];
    }

    protected function prepareForValidation(): void
    {
        if (is_string($this->input('code'))) {
            $this->merge(['code' => mb_strtoupper(trim($this->input('code')))]);
        }
    }
}
