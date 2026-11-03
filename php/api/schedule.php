<?php
/*
 * GET api/schedule.php?siteNo=0004&scnYmd=20260808
 *
 * server.js 의 /api/schedule 과 같다. 서버가 대신 CGV API 를 호출해서
 * 브라우저의 CORS 제약을 우회하고, CGV 응답을 그대로 돌려준다.
 */

define('CGV_APP', true);
require __DIR__ . '/../lib/common.php';

$siteNo = isset($_GET['siteNo']) ? (string) $_GET['siteNo'] : '';
$scnYmd = isset($_GET['scnYmd']) ? (string) $_GET['scnYmd'] : '';

if ($siteNo === '' || $scnYmd === '') {
    send_json(array('error' => 'siteNo, scnYmd 파라미터가 필요합니다.'), 400);
}

$allowed = allowed_site_nos();

if (!isset($allowed[$siteNo])) {
    send_json(array('error' => '허용되지 않은 극장 코드입니다.'), 400);
}

if (!preg_match('/^\d{8}$/', $scnYmd)) {
    send_json(array('error' => 'scnYmd 형식이 올바르지 않습니다. (YYYYMMDD)'), 400);
}

$cgvUrl =
    'https://cgv.co.kr/api/v1/booking/searchMovScnInfo' .
    '?coCd=A420' .
    '&siteNo=' . rawurlencode($siteNo) .
    '&scnYmd=' . rawurlencode($scnYmd) .
    '&rtctlScopCd=08';

function fetchSchedule($url)
{
    // CGV 는 브라우저 Referer 를 확인하므로 함께 보낸다 (UA 는 공통으로 붙는다)
    return yield http_request($url, array(
        'Accept'  => 'application/json',
        'Referer' => 'https://cgv.co.kr/',
    ));
}

try {
    $response = run_one(fetchSchedule($cgvUrl), false);
} catch (Throwable $error) {
    send_json(array('error' => 'CGV 서버 호출에 실패했습니다: ' . $error->getMessage()), 502);
}

if (!$response['ok']) {
    $status = $response['status'] >= 400 ? $response['status'] : 502;
    send_json(array('error' => 'CGV 서버 응답 오류 (HTTP ' . $response['status'] . ')'), $status);
}

// JSON 이 아닌 응답(차단 페이지 등)은 화면이 해석하지 못하므로 오류로 돌린다
json_decode($response['body']);

if (json_last_error() !== JSON_ERROR_NONE) {
    send_json(array('error' => 'CGV 서버가 JSON이 아닌 응답을 보냈습니다.'), 502);
}

send_raw_json($response['body']);
