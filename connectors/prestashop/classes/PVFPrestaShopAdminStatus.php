<?php

if (!defined('_PS_VERSION_')) {
    exit;
}

final class PVFPrestaShopAdminStatus
{
    public static function summarize($row)
    {
        if (!is_array($row)) {
            return array(
                'level' => 'gray',
                'status' => '',
                'record_id' => '',
                'last_error' => '',
                'date_upd' => '',
            );
        }

        $status = strtolower(trim((string) (isset($row['status']) ? $row['status'] : '')));
        $status = preg_replace('/[^a-z0-9_\-]/', '', $status);
        $lastError = trim((string) (isset($row['last_error']) ? $row['last_error'] : ''));
        $level = self::levelForStatus($status);

        if ($lastError !== '' && $level !== 'red') {
            $level = 'amber';
        }

        return array(
            'level' => $level,
            'status' => $status,
            'record_id' => trim((string) (isset($row['record_id']) ? $row['record_id'] : '')),
            'last_error' => $lastError,
            'date_upd' => trim((string) (isset($row['date_upd']) ? $row['date_upd'] : '')),
        );
    }

    private static function levelForStatus($status)
    {
        if ($status === '') {
            return 'gray';
        }

        if ($status === 'accepted') {
            return 'green';
        }

        if (in_array($status, array('blocked', 'rejected', 'aeat_rejected', 'failed'), true)) {
            return 'red';
        }

        return 'amber';
    }
}
