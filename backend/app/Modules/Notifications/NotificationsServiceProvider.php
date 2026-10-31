<?php

namespace App\Modules\Notifications;

use App\Modules\Shared\Infrastructure\Providers\ModuleServiceProvider;

/**
 * In-app notification inbox. Modules send Laravel database notifications; this module
 * owns the table and the API to read and acknowledge them.
 */
class NotificationsServiceProvider extends ModuleServiceProvider {}
