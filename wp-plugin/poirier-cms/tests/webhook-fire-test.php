<?php
/**
 * Standalone test for the Poirier_Optimize new-upload webhook (no WP runtime).
 * Run: php tests/webhook-fire-test.php
 *
 * Proves:
 *   - fires only when master switch on AND webhook enabled AND url+secret set
 *   - the kill-switch (master off) silences it
 *   - the request is non-blocking and carries the secret header + attachment id
 */
declare(strict_types=1);

define( 'ABSPATH', __DIR__ );
function esc_url_raw( $url ) { return $url; }
function wp_json_encode( $data, $flags = 0 ) { return json_encode( $data, $flags ); }

require_once __DIR__ . '/../includes/class-poirier-optimize.php';

$failures = 0;
function check( string $name, bool $cond ): void {
	global $failures;
	echo ( $cond ? "✓ " : "✗ FAIL " ) . $name . "\n";
	if ( ! $cond ) $failures++;
}

$URL = 'https://cms.local/api/webhooks/optimization/site-1/new-image';
$SECRET = 'abc123';

// ── should_fire (kill-switch logic) ──
check( 'fires when all on', Poirier_Optimize::should_fire( true, true, $URL, $SECRET ) === true );
check( 'kill-switch (master off) silences', Poirier_Optimize::should_fire( false, true, $URL, $SECRET ) === false );
check( 'webhook disabled → no fire', Poirier_Optimize::should_fire( true, false, $URL, $SECRET ) === false );
check( 'missing url → no fire', Poirier_Optimize::should_fire( true, true, '', $SECRET ) === false );
check( 'missing secret → no fire', Poirier_Optimize::should_fire( true, true, $URL, '' ) === false );

// ── build_webhook_request (non-blocking + secret header + body) ──
$req = Poirier_Optimize::build_webhook_request( 42, $URL, $SECRET );
check( 'posts to the callback url', $req['url'] === $URL );
check( 'is non-blocking (never slows upload)', $req['args']['blocking'] === false );
check( 'short timeout', $req['args']['timeout'] <= 2 );
check( 'sends the secret header', ( $req['args']['headers']['X-Poirier-Webhook-Secret'] ?? '' ) === $SECRET );
check( 'body carries the attachment id', strpos( (string) $req['args']['body'], '"attachmentId":42' ) !== false );

echo $failures === 0 ? "\nALL PASSED\n" : "\n{$failures} FAILED\n";
exit( $failures === 0 ? 0 : 1 );
