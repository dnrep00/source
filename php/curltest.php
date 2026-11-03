<?php
/*
 * 업로드 직후 점검 페이지.
 *
 * 이 앱은 서버가 CGV·TMDB·OMDb·네이버를 대신 호출해야 동작한다. 무료 호스팅
 * 중에는 외부 연결을 막는 곳이 있어서, 본 화면을 쓰기 전에 이 페이지로 먼저
 * 확인한다. 브라우저에서 http://(내 주소)/curltest.php 를 연다.
 *
 * 확인이 끝나면 이 파일은 서버에서 지운다. (API 키는 화면에 출력하지 않는다)
 */

define('CGV_APP', true);
require __DIR__ . '/lib/common.php';

@set_time_limit(90);

$config = app_config();
$today = date('Ymd');

/* 점검 항목: 이름 => [요청, 성공 판정 함수] */
$checks = array(

    'CGV 상영시간표' => array(
        http_request(
            'https://cgv.co.kr/api/v1/booking/searchMovScnInfo?coCd=A420&siteNo=0004&scnYmd=' . $today . '&rtctlScopCd=08',
            array('Accept' => 'application/json', 'Referer' => 'https://cgv.co.kr/')
        ),
        function ($body) {
            $json = json_decode($body, true);
            return is_array($json) && array_key_exists('data', $json)
                ? 'OK — 오늘 CGV 오리 ' . count((array) $json['data']) . '개 회차'
                : null;
        },
    ),

    'TMDB' => array(
        http_request('https://api.themoviedb.org/3/configuration?api_key=' . $config['TMDB_API_KEY']),
        function ($body) {
            $json = json_decode($body, true);
            return isset($json['images']) ? 'OK — API 키 정상' : null;
        },
    ),

    'OMDb' => array(
        http_request('https://www.omdbapi.com/?i=tt0816692&apikey=' . $config['OMDB_API_KEY']),
        function ($body) {
            $json = json_decode($body, true);
            return (isset($json['Response']) && $json['Response'] === 'True')
                ? 'OK — ' . $json['Title'] . ' IMDb ' . $json['imdbRating']
                : null;
        },
    ),

    '네이버 검색' => array(
        http_request(
            'https://search.naver.com/search.naver?query=' . rawurlencode('영화 인터스텔라 평점'),
            array('Accept-Language' => 'ko-KR,ko;q=0.9')
        ),
        function ($body) {
            return preg_match('/csearch\/contents\/(\d+)/', $body, $m)
                ? 'OK — 영화 콘텐츠 ID ' . $m[1]
                : null;
        },
    ),

    '네이버 평점 API' => array(
        http_request(
            'https://proxy-gw.entertain.naver.com/movie/api/netizen-point-list?movieCode=45290&onlyActualPoint=false&order=sympathyScore&includeSpoiler=false&page=1&pageSize=1',
            array('Accept' => 'application/json', 'Referer' => 'https://search.naver.com/')
        ),
        function ($body) {
            $json = json_decode($body, true);
            return isset($json['pointList']) ? 'OK — 관람평 응답 정상' : null;
        },
    ),
);


/* 하나씩 호출 (병렬 실행기도 함께 점검한다) */
function probe($request)
{
    $response = yield $request;
    return $response;
}

$generators = array();
foreach ($checks as $name => $check) {
    $generators[$name] = probe($check[0]);
}

$started = microtime(true);
$responses = run_parallel($generators);
$elapsed = round(microtime(true) - $started, 1);

$rows = array();
$allOk = true;

foreach ($checks as $name => $check) {
    $response = $responses[$name];

    if (isset($response['available']) && $response['available'] === false) {
        $rows[] = array($name, false, '연결 실패: ' . $response['reason']);
        $allOk = false;
        continue;
    }

    $message = $response['ok'] ? $check[1]($response['body']) : null;

    if ($message === null) {
        $rows[] = array($name, false, 'HTTP ' . $response['status'] . ' — 응답 내용이 예상과 다름');
        $allOk = false;
    } else {
        $rows[] = array($name, true, $message);
    }
}

/* 환경 점검 */
$env = array(
    array('PHP 버전', version_compare(PHP_VERSION, '7.4.0', '>='), PHP_VERSION . ' (7.4 이상 필요)'),
    array('cURL', function_exists('curl_multi_init'), function_exists('curl_version') ? 'cURL ' . curl_version()['version'] : '없음'),
    array('mbstring', function_exists('mb_strtolower'), function_exists('mb_strtolower') ? '있음' : '없음 (없어도 동작하지만 영문 대소문자 처리만 됨)'),
    array('TMDB 키', $config['TMDB_API_KEY'] !== '', $config['TMDB_API_KEY'] !== '' ? '설정됨' : 'config.php 에 없음'),
    array('OMDb 키', $config['OMDB_API_KEY'] !== '', $config['OMDB_API_KEY'] !== '' ? '설정됨' : 'config.php 에 없음'),
    array('cache 폴더 쓰기', is_writable(CACHE_DIR), is_writable(CACHE_DIR) ? '가능' : '불가 — FTP 에서 cache 폴더 권한을 707 로'),
    array('극장 코드', count(allowed_site_nos()) > 0, count(allowed_site_nos()) . '개 (theaters.js)'),
);

function h($value)
{
    return htmlspecialchars((string) $value, ENT_QUOTES, 'UTF-8');
}

header('Content-Type: text/html; charset=utf-8');
header('Cache-Control: no-store');
?>
<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<title>CGV 상영시간표 — 서버 점검</title>
<style>
  body { font-family: "Malgun Gothic", sans-serif; max-width: 760px; margin: 40px auto; padding: 0 20px; color: #1a1a1a; }
  h1 { font-size: 20px; }
  h2 { font-size: 15px; margin-top: 28px; }
  table { border-collapse: collapse; width: 100%; font-size: 14px; }
  td { border-bottom: 1px solid #ececec; padding: 9px 8px; vertical-align: top; }
  td:first-child { width: 150px; font-weight: 600; }
  td:nth-child(2) { width: 50px; font-weight: 700; }
  .ok { color: #1a7f37; }
  .ng { color: #c0392b; }
  .summary { padding: 14px 16px; border-radius: 6px; font-weight: 600; margin: 18px 0; }
  .summary.ok { background: #e9f7ee; }
  .summary.ng { background: #fdeeee; }
  .note { color: #777; font-size: 13px; }
</style>
</head>
<body>

<h1>CGV 상영시간표 — 서버 점검</h1>

<div class="summary <?= $allOk ? 'ok' : 'ng' ?>">
  <?= $allOk
      ? '외부 호출이 모두 정상입니다. index.html 에서 조회해보세요.'
      : '막힌 곳이 있습니다. 실패한 항목은 그 기능(상영시간표 / 영화 정보)이 동작하지 않습니다.' ?>
</div>

<h2>외부 연결 (<?= h($elapsed) ?>초)</h2>
<table>
<?php foreach ($rows as $row): ?>
  <tr>
    <td><?= h($row[0]) ?></td>
    <td class="<?= $row[1] ? 'ok' : 'ng' ?>"><?= $row[1] ? '정상' : '실패' ?></td>
    <td><?= h($row[2]) ?></td>
  </tr>
<?php endforeach; ?>
</table>

<h2>서버 환경</h2>
<table>
<?php foreach ($env as $row): ?>
  <tr>
    <td><?= h($row[0]) ?></td>
    <td class="<?= $row[1] ? 'ok' : 'ng' ?>"><?= $row[1] ? '정상' : '확인' ?></td>
    <td><?= h($row[2]) ?></td>
  </tr>
<?php endforeach; ?>
</table>

<p class="note">확인이 끝나면 이 파일(curltest.php)은 서버에서 지워주세요.</p>

</body>
</html>
