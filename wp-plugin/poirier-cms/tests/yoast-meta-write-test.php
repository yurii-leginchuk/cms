<?php
/**
 * Standalone test for Poirier_API::resolve_meta_write (no WordPress runtime).
 * Run: docker run --rm -v "$PWD":/app php:8.1-cli php /app/tests/yoast-meta-write-test.php
 *
 * Guards the present/empty/absent tri-state that keeps the CMS from silently
 * clobbering a client's existing Yoast config:
 *   - field ABSENT from the request body → 'skip'   (leave Yoast untouched)
 *   - field present but '' / null         → 'delete' (reset to Yoast default)
 *   - field present with a value          → 'set'
 */
declare(strict_types=1);

define( 'ABSPATH', __DIR__ );

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

// Simulate "is this key present in the JSON body?" + its value.
$R = static fn( bool $present, $value ) => Poirier_API::resolve_meta_write( $present, $value );

// Absent → skip (the #1 anti-clobber guarantee).
check( 'absent → skip',                 [ 'action' => 'skip' ],               $R( false, null ) );
check( 'absent (ignores value) → skip', [ 'action' => 'skip' ],               $R( false, 'whatever' ) );

// Present + empty/null → delete (reset to Yoast default).
check( 'present null → delete',         [ 'action' => 'delete' ],             $R( true, null ) );
check( 'present "" → delete',           [ 'action' => 'delete' ],             $R( true, '' ) );

// Present + value → set.
check( 'present "1" → set 1',           [ 'action' => 'set', 'value' => '1' ], $R( true, '1' ) );
check( 'present canonical → set',       [ 'action' => 'set', 'value' => 'https://x.test/' ], $R( true, 'https://x.test/' ) );
check( 'present "0" → set 0 (not empty)',[ 'action' => 'set', 'value' => '0' ], $R( true, '0' ) );

// ── Open Graph image decision (URL + attachment id together) ─────────────────
$OG = static fn( bool $op, $ov, bool $ip, $iv ) => Poirier_API::resolve_og_image_write( $op, $ov, $ip, $iv );

// ogImage absent → skip (don't touch Yoast's image).
check( 'og absent → skip',              [ 'action' => 'skip' ],  $OG( false, null, false, null ) );
// ogImage present-empty → clear (delete URL + id).
check( 'og present null → clear',       [ 'action' => 'clear' ], $OG( true, null, false, null ) );
check( 'og present "" → clear',         [ 'action' => 'clear' ], $OG( true, '', true, 0 ) );
// Library image: positive id → set with id.
check( 'og + id 10520 → set lib',
	[ 'action' => 'set', 'url' => 'https://x.test/a.jpg', 'id' => 10520 ],
	$OG( true, 'https://x.test/a.jpg', true, 10520 ) );
// External URL with no id → set with id 0 (clears any stale attachment id).
check( 'og url, no id → set external',
	[ 'action' => 'set', 'url' => 'https://x.test/b.jpg', 'id' => 0 ],
	$OG( true, 'https://x.test/b.jpg', false, null ) );
// External URL with id present-but-null/zero → still external (id 0).
check( 'og url, id null → set external',
	[ 'action' => 'set', 'url' => 'https://x.test/c.jpg', 'id' => 0 ],
	$OG( true, 'https://x.test/c.jpg', true, null ) );
check( 'og url, id "0" → set external',
	[ 'action' => 'set', 'url' => 'https://x.test/d.jpg', 'id' => 0 ],
	$OG( true, 'https://x.test/d.jpg', true, '0' ) );

echo $failures === 0 ? "\nALL PASSED\n" : "\n{$failures} FAILED\n";
exit( $failures === 0 ? 0 : 1 );
