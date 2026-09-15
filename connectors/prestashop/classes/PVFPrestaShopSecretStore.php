<?php

if (!defined('_PS_VERSION_')) {
    exit;
}

final class PVFPrestaShopSecretStore
{
    const CONFIG_KEY = 'PVF_API_TOKEN_ENC';
    const AAD = 'puente-verifactu-prestashop:v1';

    public static function set($token, $idShop)
    {
        $token = trim((string) $token);
        if ($token === '') {
            return self::delete($idShop);
        }
        if (!function_exists('openssl_encrypt')) {
            throw new RuntimeException('OpenSSL is required to protect the Puente VeriFactu token.');
        }

        $key = self::key();
        $iv = random_bytes(12);
        $tag = '';
        $ciphertext = openssl_encrypt(
            $token,
            'aes-256-gcm',
            $key,
            OPENSSL_RAW_DATA,
            $iv,
            $tag,
            self::AAD,
            16
        );
        if ($ciphertext === false || strlen($tag) !== 16) {
            throw new RuntimeException('Could not encrypt the Puente VeriFactu token.');
        }

        $encoded = 'v1:' . base64_encode($iv . $tag . $ciphertext);
        return Configuration::updateValue(self::CONFIG_KEY, $encoded, false, null, (int) $idShop);
    }

    public static function get($idShop)
    {
        $stored = (string) Configuration::get(self::CONFIG_KEY, null, null, (int) $idShop);
        if ($stored === '' || strpos($stored, 'v1:') !== 0) {
            return '';
        }
        if (!function_exists('openssl_decrypt')) {
            return '';
        }

        $raw = base64_decode(substr($stored, 3), true);
        if ($raw === false || strlen($raw) < 29) {
            return '';
        }
        $iv = substr($raw, 0, 12);
        $tag = substr($raw, 12, 16);
        $ciphertext = substr($raw, 28);
        $plaintext = openssl_decrypt(
            $ciphertext,
            'aes-256-gcm',
            self::key(),
            OPENSSL_RAW_DATA,
            $iv,
            $tag,
            self::AAD
        );

        return $plaintext === false ? '' : (string) $plaintext;
    }

    public static function delete($idShop)
    {
        return Configuration::deleteByName(self::CONFIG_KEY);
    }

    private static function key()
    {
        if (!defined('_COOKIE_KEY_') || _COOKIE_KEY_ === '') {
            throw new RuntimeException('PrestaShop cookie key is unavailable.');
        }
        return hash('sha256', (string) _COOKIE_KEY_, true);
    }
}
