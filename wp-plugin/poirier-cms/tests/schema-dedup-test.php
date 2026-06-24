<?php
/**
 * Standalone test for Poirier_Schema dedup/render (no WordPress runtime).
 * Run: php tests/schema-dedup-test.php
 */
declare(strict_types=1);

define( 'ABSPATH', __DIR__ );
// Minimal WP stubs used by the methods under test.
function wp_json_encode( $data, $flags = 0 ) { return json_encode( $data, $flags ); }

require_once __DIR__ . '/../includes/class-poirier-schema.php';

$failures = 0;
function check( string $name, bool $cond ): void {
	global $failures;
	echo ( $cond ? "✓ " : "✗ FAIL " ) . $name . "\n";
	if ( ! $cond ) $failures++;
}

// Managed set the CMS owns and will publish.
$managed = [
	[ 'type' => 'FAQPage', 'jsonld' => [ '@context' => 'https://schema.org', '@type' => 'FAQPage', 'mainEntity' => [] ] ],
	[ 'type' => 'Organization', 'jsonld' => [ '@context' => 'https://schema.org', '@type' => 'Organization', 'name' => 'Poirier (CMS)' ] ],
];

// A Yoast @graph + a standalone Article + an "other plugin" block — ALL non-CMS.
$yoast = json_encode( [
	'@context' => 'https://schema.org',
	'@graph'   => [
		[ '@type' => 'WebPage', '@id' => 'https://x/#webpage', 'name' => 'Page' ],
		[ '@type' => 'Organization', '@id' => 'https://x/#org', 'name' => 'Yoast Org' ],
		[ '@type' => 'WebSite', '@id' => 'https://x/#website' ],
	],
] );
$article = json_encode( [ '@context' => 'https://schema.org', '@type' => 'Article', 'headline' => 'Hi' ] );

$head = "<title>T</title>\n"
	. '<script type="application/ld+json" class="yoast-schema-graph">' . $yoast . "</script>\n"
	. '<script type="application/ld+json">' . $article . "</script>";

// CMS is authoritative → EVERY non-CMS JSON-LD block is removed.
$stripped = Poirier_Schema::strip_foreign( $head );
check( 'Yoast graph fully removed', strpos( $stripped, 'Yoast Org' ) === false && strpos( $stripped, '#webpage' ) === false );
check( 'standalone Article removed', strpos( $stripped, 'Article' ) === false );
check( 'non-schema head markup preserved', strpos( $stripped, '<title>T</title>' ) !== false );

$scripts = Poirier_Schema::render_scripts( $managed );
check( 'managed FAQPage rendered + tagged', strpos( $scripts, 'poirier-schema' ) !== false && strpos( $scripts, 'FAQPage' ) !== false );
check( 'managed Organization rendered (CMS copy)', strpos( $scripts, 'Poirier (CMS)' ) !== false );

// Our own blocks are never stripped.
$ours = '<script type="application/ld+json" class="poirier-schema">' . json_encode( [ '@type' => 'Organization', 'name' => 'Mine' ] ) . '</script>';
check( 'our own poirier-schema block survives', strpos( Poirier_Schema::strip_foreign( $ours ), 'Mine' ) !== false );

// XSS: a </script> inside a value must be neutralised.
$xss = Poirier_Schema::render_scripts( [ [ 'type' => 'Thing', 'jsonld' => [ '@type' => 'Thing', 'name' => '</script><script>alert(1)' ] ] ] );
check( 'inline </script> breakout neutralised', stripos( $xss, '</script><script>alert' ) === false );

echo $failures === 0 ? "\nALL PASSED\n" : "\n{$failures} FAILED\n";
exit( $failures === 0 ? 0 : 1 );
