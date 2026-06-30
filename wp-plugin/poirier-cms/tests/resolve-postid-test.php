<?php
/**
 * Standalone test for Poirier_API::resolve_post_id (no WordPress runtime).
 * Run: php tests/resolve-postid-test.php
 *
 * Guards the query-string resolution fix: a ?p=/?page_id= URL must resolve to its
 * post, NOT be mistaken for the homepage once the query string is stripped.
 */
declare(strict_types=1);

define( 'ABSPATH', __DIR__ );

// ── Minimal WP stubs used by resolve_post_id ──────────────────────────────────
function get_option( $key, $default = false ) {
	// Static front page id = 1290 (matches the test site).
	return $key === 'page_on_front' ? 1290 : $default;
}
function home_url( $path = '' ) { return 'http://site' . $path; }
function trailingslashit( $s ) { return rtrim( (string) $s, '/' ) . '/'; }
function untrailingslashit( $s ) { return rtrim( (string) $s, '/' ); }
function url_to_postid( $url ) {
	// Pretty permalinks the stub "knows".
	$map = [
		'http://site/services/' => 55,
		'http://site/home/'     => 1290, // pretty permalink of the static front page
	];
	$path = strtok( $url, '?' );
	$path = rtrim( $path, '/' ) . '/';
	return $map[ $path ] ?? 0;
}

require_once __DIR__ . '/../includes/class-poirier-api.php';

$failures = 0;
function check( string $name, $expected, $actual ): void {
	global $failures;
	$ok = $expected === $actual;
	echo ( $ok ? '✓ ' : '✗ FAIL ' ) . $name
		. ( $ok ? '' : " (expected " . var_export( $expected, true ) . ", got " . var_export( $actual, true ) . ")" )
		. "\n";
	if ( ! $ok ) $failures++;
}

$R = static fn( string $u ) => Poirier_API::resolve_post_id( $u );

// The bug: these used to all return 'homepage'.
check( '?p=9533 → post 9533',            9533, $R( 'http://site/?p=9533' ) );
check( '?page_id=42 → post 42',          42,   $R( 'http://site/?page_id=42' ) );
check( '?attachment_id=7 → post 7',      7,    $R( 'http://site/?attachment_id=7' ) );

// Front page, however addressed, normalises to 'homepage'.
check( 'bare home URL → homepage',       'homepage', $R( 'http://site/' ) );
check( '?page_id=1290 (front) → homepage','homepage', $R( 'http://site/?page_id=1290' ) );
check( '?p=1290 (front) → homepage',     'homepage', $R( 'http://site/?p=1290' ) );
check( 'pretty /home/ (front) → homepage','homepage', $R( 'http://site/home/' ) );

// Pretty permalinks still resolve; tracking params are ignored.
check( '/services/ → post 55',           55,   $R( 'http://site/services/' ) );
check( '/services/?utm=x → post 55',     55,   $R( 'http://site/services/?utm=x' ) );

// Non-identifying query on home path is still the homepage.
check( '/?utm_source=x → homepage',      'homepage', $R( 'http://site/?utm_source=x' ) );

echo $failures === 0 ? "\nALL PASSED\n" : "\n{$failures} FAILED\n";
exit( $failures === 0 ? 0 : 1 );
