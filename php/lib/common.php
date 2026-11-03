<?php
/*
 * 공통 기능 (server.js 상단부의 PHP 이식)
 *
 *   - config.php 에서 API 키 읽기       (server.js loadEnvFile)
 *   - 극장 코드 화이트리스트            (server.js ALLOWED_SITE_NOS)
 *   - HTTP 호출 + 병렬 실행기           (server.js httpFetch, Promise.all)
 *   - 영화 정보 파일 캐시               (server.js movieCache)
 *   - JSON 응답
 *
 * 이 파일을 브라우저로 직접 열면 아무것도 출력하지 않고 끝난다.
 * (api/*.php 가 CGV_APP 을 정의한 뒤에만 동작)
 *
 * PHP 7.4 이상에서 동작하도록 작성했다. 8.0 전용 문법(match, str_starts_with,
 * named arguments, nullsafe 연산자)은 쓰지 않는다.
 */

if (!defined('CGV_APP')) {
    exit;
}

define('APP_ROOT', dirname(__DIR__));


/* ------------------------------------------------------------------
 * 설정
 * ------------------------------------------------------------------ */

/*
 * API 키는 .env 가 아니라 config.php 에 둔다.
 *
 * 무료 호스팅은 .htaccess 지원 여부가 확실하지 않아서, .env 를 웹 폴더에 두면
 * http://.../.env 로 키가 그대로 노출될 수 있다. config.php 는 직접 열어도
 * PHP로 실행될 뿐 아무것도 출력하지 않으므로 그런 걱정이 없다.
 */
function app_config()
{
    static $config = null;

    if ($config !== null) {
        return $config;
    }

    $config = array('TMDB_API_KEY' => '', 'OMDB_API_KEY' => '');

    $path = APP_ROOT . '/config.php';

    if (is_file($path)) {
        $loaded = include $path;
        if (is_array($loaded)) {
            $config = array_merge($config, $loaded);
        }
    }

    // 환경변수가 있으면 그 값을 우선한다. (server.js 와 같은 규칙)
    foreach (array('TMDB_API_KEY', 'OMDB_API_KEY') as $key) {
        $env = getenv($key);
        if ($env !== false && $env !== '') {
            $config[$key] = $env;
        }
    }

    $config['TMDB_API_KEY'] = trim((string) $config['TMDB_API_KEY']);
    $config['OMDB_API_KEY'] = trim((string) $config['OMDB_API_KEY']);

    return $config;
}


/*
 * 허용된 극장 코드 목록.
 *
 * PHP는 theaters.js 를 require 할 수 없으므로 파일에서 code: "..." 만 뽑는다.
 * 극장을 추가할 때 theaters.js 만 고치면 화면과 서버에 함께 반영되는 구조는
 * Node 버전과 같다.
 */
function allowed_site_nos()
{
    static $codes = null;

    if ($codes !== null) {
        return $codes;
    }

    $codes = array();
    $source = @file_get_contents(APP_ROOT . '/theaters.js');

    if ($source !== false &&
        preg_match_all('/\bcode\s*:\s*["\']([^"\']+)["\']/', $source, $matches)) {
        foreach ($matches[1] as $code) {
            $codes[$code] = true;
        }
    }

    return $codes;
}


/* ------------------------------------------------------------------
 * JSON 응답
 * ------------------------------------------------------------------ */

function send_json($data, $status = 200)
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');

    echo json_encode(
        $data,
        JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PARTIAL_OUTPUT_ON_ERROR
    );
    exit;
}

/*
 * 이미 JSON 문자열인 본문을 그대로 내보낸다.
 * CGV 응답을 디코드했다가 다시 인코드하면 빈 객체 {} 가 [] 로 바뀌는 등
 * 원본과 달라질 수 있어서, 상영시간표는 받은 그대로 넘긴다.
 */
function send_raw_json($body, $status = 200)
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');

    echo $body;
    exit;
}


/* ------------------------------------------------------------------
 * HTTP 호출
 *
 * server.js 의 async/await 흐름을 PHP 제너레이터로 옮겼다.
 *
 *   Node:  const response = await httpFetch(url, { headers })
 *   PHP:   $response = yield http_request($url, $headers);
 *
 *   Node:  const x = await otherAsyncFunction()
 *   PHP:   $x = yield from otherFunction();
 *
 * 이렇게 쓴 함수 여러 개를 run_parallel() 에 넘기면 curl_multi 로 동시에
 * 진행된다. (server.js 의 Promise.all 에 해당)
 * ------------------------------------------------------------------ */

define('BROWSER_UA',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' .
    'AppleWebKit/537.36 (KHTML, like Gecko) ' .
    'Chrome/124.0.0.0 Safari/537.36');

define('HTTP_TIMEOUT', 10);   // 초. server.js 와 같은 10초


/* 제너레이터가 yield 하는 "요청" 한 건 */
function http_request($url, $headers = array())
{
    return array('url' => $url, 'headers' => $headers);
}

/* 응답 본문을 JSON 으로 해석한다. 실패하면 예외 (Node 의 response.json() 과 같다) */
function response_json($response)
{
    $data = json_decode($response['body'], true);

    if ($data === null && json_last_error() !== JSON_ERROR_NONE) {
        throw new Exception('응답을 JSON으로 해석하지 못했습니다 (HTTP ' . $response['status'] . ')');
    }

    return $data;
}

function make_curl_handle($request)
{
    $headers = array_merge(array('User-Agent' => BROWSER_UA), $request['headers']);
    $lines = array();

    foreach ($headers as $name => $value) {
        $lines[] = $name . ': ' . $value;
    }

    $ch = curl_init($request['url']);

    curl_setopt_array($ch, array(
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_MAXREDIRS      => 5,
        CURLOPT_CONNECTTIMEOUT => HTTP_TIMEOUT,
        CURLOPT_TIMEOUT        => HTTP_TIMEOUT,   // 본문을 다 받을 때까지 포함
        CURLOPT_HTTPHEADER     => $lines,
        CURLOPT_ENCODING       => '',             // gzip 등 자동 해제
    ));

    return $ch;
}


/*
 * 제너레이터 여러 개를 동시에 실행하고 각각의 반환값을 돌려준다.
 *
 * $settle 이 true 이면, 제너레이터 안에서 예외가 나도 전체를 멈추지 않고
 * 그 자리에 { available: false, reason } 을 넣는다.
 * (server.js 의 settle(promise) 와 같다 — 한 소스가 실패해도 나머지는 보여준다)
 */
function run_parallel(array $generators, $settle = true)
{
    $results = array();
    $active = array();          // 문자열 키 => Generator
    $handles = array();         // curl 핸들 id => 키

    $mh = curl_multi_init();

    $fail = function ($key, $error) use (&$results, $settle) {
        if (!$settle) {
            throw $error;
        }
        $results[$key] = array('available' => false, 'reason' => $error->getMessage());
    };

    /*
     * 제너레이터를 다음 yield 지점까지 진행시킨 뒤, 요청을 걸거나 결과를 거둔다.
     * $step 은 제너레이터를 한 단계 움직이는 함수. (current / send / throw)
     */
    $advance = function ($key, $step) use (&$active, &$handles, &$results, $mh, $fail) {
        $generator = $active[$key];

        try {
            $request = $step($generator);
        } catch (Throwable $error) {
            unset($active[$key]);
            $fail($key, $error);
            return;
        }

        if (!$generator->valid()) {
            unset($active[$key]);
            $results[$key] = $generator->getReturn();
            return;
        }

        $ch = make_curl_handle($request);
        $handles[handle_id($ch)] = $key;
        curl_multi_add_handle($mh, $ch);
    };

    foreach ($generators as $key => $generator) {
        $active[$key] = $generator;
        $advance($key, function ($g) { return $g->current(); });
    }

    while ($handles) {

        do {
            $status = curl_multi_exec($mh, $running);
        } while ($status === CURLM_CALL_MULTI_PERFORM);

        while (($info = curl_multi_info_read($mh)) !== false) {

            $ch = $info['handle'];
            $key = $handles[handle_id($ch)];
            unset($handles[handle_id($ch)]);

            if ($info['result'] === CURLE_OK) {
                $code = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
                $response = array(
                    'ok'     => $code >= 200 && $code < 300,
                    'status' => $code,
                    'body'   => (string) curl_multi_getcontent($ch),
                );
                $error = null;
            } else {
                $response = null;
                $error = new Exception(curl_error($ch) ?: curl_strerror($info['result']));
            }

            curl_multi_remove_handle($mh, $ch);
            curl_close($ch);

            if ($error === null) {
                $advance($key, function ($g) use ($response) { return $g->send($response); });
            } else {
                $advance($key, function ($g) use ($error) { return $g->throw($error); });
            }
        }

        if ($handles && curl_multi_select($mh, 1.0) === -1) {
            usleep(10000);
        }
    }

    curl_multi_close($mh);

    // 넘겨받은 순서대로 정렬해서 돌려준다
    $ordered = array();
    foreach ($generators as $key => $unused) {
        $ordered[$key] = array_key_exists($key, $results) ? $results[$key] : null;
    }

    return $ordered;
}

/*
 * curl 핸들을 배열 키로 쓰기 위한 번호.
 * PHP 7 은 리소스라 (int) 로 되지만, PHP 8 은 CurlHandle 객체라 (int) 하면
 * 경고와 함께 모두 1 이 되어 버린다.
 */
function handle_id($ch)
{
    return is_object($ch) ? spl_object_id($ch) : (int) $ch;
}

/* 제너레이터 하나만 실행 */
function run_one(Generator $generator, $settle = true)
{
    $results = run_parallel(array('only' => $generator), $settle);
    return $results['only'];
}


/* ------------------------------------------------------------------
 * 영화 정보 캐시
 *
 * Node 는 서버가 계속 떠 있어서 메모리 Map 에 담았지만, PHP 는 요청마다
 * 메모리가 사라지므로 cache/ 폴더에 파일로 둔다. OMDb 무료 키가 하루
 * 1,000건이라 캐시를 빼면 안 된다.
 * ------------------------------------------------------------------ */

define('CACHE_DIR', APP_ROOT . '/cache');
define('MOVIE_CACHE_TTL', 6 * 60 * 60);    // 6시간 (정상 조회)
define('PARTIAL_CACHE_TTL', 3 * 60);       // 3분 (일부 실패) — 일시적 실패를 오래 붙잡지 않기 위해

function cache_path($key)
{
    return CACHE_DIR . '/' . md5($key) . '.json';
}

function cache_get($key)
{
    $path = cache_path($key);

    if (!is_file($path)) {
        return null;
    }

    $entry = json_decode((string) @file_get_contents($path), true);

    if (!is_array($entry) || !isset($entry['at'], $entry['ttl']) ||
        time() - $entry['at'] >= $entry['ttl']) {
        return null;
    }

    return $entry['payload'];
}

function cache_set($key, $payload, $ttl)
{
    if (!is_dir(CACHE_DIR) && !@mkdir(CACHE_DIR, 0755, true)) {
        return;   // 캐시를 못 써도 응답은 정상으로 내보낸다
    }

    cache_prune();

    $entry = array('at' => time(), 'ttl' => $ttl, 'payload' => $payload);

    @file_put_contents(
        cache_path($key),
        json_encode($entry, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PARTIAL_OUTPUT_ON_ERROR),
        LOCK_EX
    );
}

/*
 * 만료된 캐시 파일을 지운다. (server.js pruneMovieCache)
 * 매번 폴더를 훑을 필요는 없어서 20번에 한 번꼴로만 돈다.
 * 정상 조회 TTL(6시간)보다 오래된 파일은 무엇이든 만료된 것이므로
 * 파일을 열지 않고 수정시각만 본다.
 */
function cache_prune()
{
    if (mt_rand(1, 20) !== 1) {
        return;
    }

    $limit = time() - MOVIE_CACHE_TTL;

    foreach ((array) glob(CACHE_DIR . '/*.json') as $file) {
        if (@filemtime($file) < $limit) {
            @unlink($file);
        }
    }
}


/* ------------------------------------------------------------------
 * JavaScript 동작을 맞추기 위한 작은 도우미
 * ------------------------------------------------------------------ */

/* JS 의 a || b. PHP 와 달리 "0" 은 참으로 본다. */
function js_or($value, $fallback)
{
    if ($value === null || $value === false || $value === '' || $value === 0 || $value === 0.0) {
        return $fallback;
    }
    return $value;
}

/* $array[$key] 가 없으면 null */
function get($array, $key)
{
    return (is_array($array) && array_key_exists($key, $array)) ? $array[$key] : null;
}

/* JS 의 String.prototype.trim (유니코드 공백까지 제거) */
function js_trim($value)
{
    return preg_replace('/^\s+|\s+$/u', '', (string) $value);
}

/* JS 의 toLowerCase */
function js_lower($value)
{
    return function_exists('mb_strtolower')
        ? mb_strtolower((string) $value, 'UTF-8')
        : strtolower((string) $value);
}

/* JS 의 String(number). 9.0 → "9", 8.67 → "8.67" */
function js_string($value)
{
    if ($value === null) {
        return '';
    }
    if (is_bool($value)) {
        return $value ? 'true' : 'false';
    }
    return (string) $value;
}

/* JS 의 number.toLocaleString("en-US") — 참여자 수 표기 (1,234) */
function format_count($value)
{
    if (!is_numeric($value)) {
        return js_string($value);
    }
    $number = $value + 0;
    if (is_int($number) || floor($number) == $number) {
        return number_format($number);
    }
    return rtrim(rtrim(number_format($number, 3), '0'), '.');
}
