<?php
/**
 * Endpoint adicionado ao token.php para o novo app MegaLabs (mega-price-buddy.lovable.app)
 * 
 * Cole este código DENTRO do switch/if do seu token.php existente,
 * ou adicione como novo arquivo e inclua no token.php.
 *
 * App ML: ID 285337336691848
 * Redirect URI: https://mega-price-buddy.lovable.app/auth/callback
 */

header('Access-Control-Allow-Origin: https://mega-price-buddy.lovable.app');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
header('Content-Type: application/json');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

$ML_CLIENT_ID     = '285337336691848';
$ML_CLIENT_SECRET = 'FppbNCTNuvQJfLfpcGcgDIRFQRpVxYTn';
$ML_REDIRECT_URI  = 'https://mega-price-buddy.lovable.app/auth/callback';

$body   = json_decode(file_get_contents('php://input'), true);
$action = $body['action'] ?? '';

// ── exchange_v2: troca code por token (com client_secret) ─────────────────
if ($action === 'exchange_v2') {
    $code          = $body['code']          ?? '';
    $code_verifier = $body['code_verifier'] ?? '';

    if (!$code || !$code_verifier) {
        http_response_code(400);
        echo json_encode(['error' => 'code e code_verifier são obrigatórios']);
        exit;
    }

    $postData = http_build_query([
        'grant_type'    => 'authorization_code',
        'client_id'     => $ML_CLIENT_ID,
        'client_secret' => $ML_CLIENT_SECRET,
        'code'          => $code,
        'redirect_uri'  => $ML_REDIRECT_URI,
        'code_verifier' => $code_verifier,
    ]);

    $ch = curl_init('https://auth.mercadolivre.com.br/jms/oauth/token');
    curl_setopt_array($ch, [
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => $postData,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER     => [
            'Content-Type: application/x-www-form-urlencoded',
            'Accept: application/json',
        ],
    ]);

    $response   = curl_exec($ch);
    $httpCode   = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    http_response_code($httpCode);
    echo $response;
    exit;
}

// ── refresh_v2: renova token ───────────────────────────────────────────────
if ($action === 'refresh_v2') {
    $refresh_token = $body['refresh_token'] ?? '';

    if (!$refresh_token) {
        http_response_code(400);
        echo json_encode(['error' => 'refresh_token é obrigatório']);
        exit;
    }

    $postData = http_build_query([
        'grant_type'    => 'refresh_token',
        'client_id'     => $ML_CLIENT_ID,
        'client_secret' => $ML_CLIENT_SECRET,
        'refresh_token' => $refresh_token,
    ]);

    $ch = curl_init('https://auth.mercadolivre.com.br/jms/oauth/token');
    curl_setopt_array($ch, [
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => $postData,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER     => [
            'Content-Type: application/x-www-form-urlencoded',
            'Accept: application/json',
        ],
    ]);

    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    http_response_code($httpCode);
    echo $response;
    exit;
}
