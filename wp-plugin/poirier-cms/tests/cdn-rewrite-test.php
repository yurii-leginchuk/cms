<?php
/**
 * Standalone test for Poirier_Optimize CDN rewrite (no WordPress runtime).
 * Run: php tests/cdn-rewrite-test.php
 *
 * Proves the three safety behaviours:
 *   - mapped attachment  → rewritten to CDN
 *   - unmapped attachment → original preserved (images never disappear)
 *   - kill-switch off     → everything untouched
 */
declare(strict_types=1);

define( 'ABSPATH', __DIR__ );
function esc_url_raw( $url ) { return $url; } // WP stub

require_once __DIR__ . '/../includes/class-poirier-optimize.php';

$failures = 0;
function check( string $name, bool $cond ): void {
	global $failures;
	echo ( $cond ? "✓ " : "✗ FAIL " ) . $name . "\n";
	if ( ! $cond ) $failures++;
}

$map = [ 123 => 'https://cdn.x/img/abc.webp' ];

// ── wp_get_attachment_image_src array ──
$img = [ 'https://wp/wp-content/uploads/2024/hero.jpg', 1200, 800, false ];

$mapped = Poirier_Optimize::rewrite_src_array( $img, 123, $map, true );
check( 'mapped src rewritten to CDN', $mapped[0] === 'https://cdn.x/img/abc.webp' );
check( 'width/height preserved', $mapped[1] === 1200 && $mapped[2] === 800 );

$unmapped = Poirier_Optimize::rewrite_src_array( $img, 999, $map, true );
check( 'unmapped src preserved (original WP URL)', $unmapped[0] === $img[0] );

$killed = Poirier_Optimize::rewrite_src_array( $img, 123, $map, false );
check( 'kill-switch → src untouched', $killed[0] === $img[0] );

// ── wp_calculate_image_srcset ──
$sources = [
	300  => [ 'url' => 'https://wp/uploads/hero-300.jpg', 'descriptor' => 'w', 'value' => 300 ],
	1200 => [ 'url' => 'https://wp/uploads/hero.jpg', 'descriptor' => 'w', 'value' => 1200 ],
];
check( 'mapped srcset dropped (single CDN object)', Poirier_Optimize::rewrite_srcset( $sources, 123, $map, true ) === [] );
check( 'unmapped srcset preserved', Poirier_Optimize::rewrite_srcset( $sources, 999, $map, true ) === $sources );
check( 'kill-switch → srcset untouched', Poirier_Optimize::rewrite_srcset( $sources, 123, $map, false ) === $sources );

// ── wp_content_img_tag ──
$html = '<img src="https://wp/wp-content/uploads/2024/hero.jpg" '
	. 'srcset="https://wp/uploads/hero-300.jpg 300w, https://wp/uploads/hero.jpg 1200w" '
	. 'sizes="(max-width:1200px) 100vw, 1200px" alt="Hero image" width="1200" height="800" />';

$rw = Poirier_Optimize::rewrite_content_img( $html, 123, $map, true );
check( 'content src rewritten to CDN', strpos( $rw, 'src="https://cdn.x/img/abc.webp"' ) !== false );
check( 'content srcset stripped', strpos( $rw, 'srcset=' ) === false );
check( 'content sizes stripped', strpos( $rw, 'sizes=' ) === false );
check( 'content alt preserved', strpos( $rw, 'alt="Hero image"' ) !== false );
check( 'content width/height preserved', strpos( $rw, 'width="1200"' ) !== false );

$un = Poirier_Optimize::rewrite_content_img( $html, 999, $map, true );
check( 'unmapped content untouched', $un === $html );

$ks = Poirier_Optimize::rewrite_content_img( $html, 123, $map, false );
check( 'kill-switch → content untouched', $ks === $html );

echo $failures === 0 ? "\nALL PASSED\n" : "\n{$failures} FAILED\n";
exit( $failures === 0 ? 0 : 1 );
