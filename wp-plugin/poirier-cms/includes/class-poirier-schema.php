<?php
/**
 * Poirier CMS — JSON-LD schema receiver + renderer.
 *
 * Receives managed schemas from the CMS and stores them per post (or as a site
 * option for the homepage). On the front end it renders them and — per product
 * decision — makes the CMS schema WIN: any other JSON-LD on the page (Yoast,
 * other plugins, theme) whose top-level @type collides with a managed type is
 * stripped from the final HTML, so there are no duplicates.
 *
 * Dedup is done by buffering the whole <head>: all JSON-LD blocks produced in
 * wp_head are captured, colliding nodes removed, then our schemas appended last.
 */

declare(strict_types=1);

if ( ! defined( 'ABSPATH' ) ) exit;

class Poirier_Schema {

	private const NAMESPACE   = 'poirier-cms/v1';
	private const META_KEY    = '_poirier_schema';
	private const HOME_OPTION = 'poirier_cms_schema_home';

	/** @var array<int,array{type:string,jsonld:mixed}>|null */
	private static $managed_cache = null;
	private static bool $buffering = false;

	// ── Wiring ────────────────────────────────────────────────────────────────

	public static function register_routes(): void {
		register_rest_route( self::NAMESPACE, '/schema', [
			[
				'methods'             => 'POST',
				'callback'            => [ self::class, 'handle_set' ],
				'permission_callback' => [ 'Poirier_API', 'authenticate' ],
			],
			[
				'methods'             => 'GET',
				'callback'            => [ self::class, 'handle_get' ],
				'permission_callback' => [ 'Poirier_API', 'authenticate' ],
			],
			[
				'methods'             => 'DELETE',
				'callback'            => [ self::class, 'handle_delete' ],
				'permission_callback' => [ 'Poirier_API', 'authenticate' ],
			],
		] );
	}

	public static function register_render_hooks(): void {
		// Wrap the entire <head> so we can dedup whatever any source emits there.
		add_action( 'wp_head', [ self::class, 'maybe_start_buffer' ], -PHP_INT_MAX );
		add_action( 'wp_head', [ self::class, 'flush_buffer' ], PHP_INT_MAX );
	}

	// ── REST handlers ───────────────────────────────────────────────────────────

	public static function handle_set( WP_REST_Request $request ): WP_REST_Response|WP_Error {
		$page_url = (string) $request->get_param( 'pageUrl' );
		$schemas  = $request->get_param( 'schemas' );

		if ( ! is_array( $schemas ) ) {
			return new WP_Error( 'bad_request', '"schemas" must be an array.', [ 'status' => 400 ] );
		}

		// Normalise to [{type, jsonld}], keeping only well-formed entries.
		$clean = [];
		foreach ( $schemas as $s ) {
			if ( ! is_array( $s ) || ! isset( $s['jsonld'] ) ) continue;
			$clean[] = [
				'type'   => isset( $s['type'] ) ? (string) $s['type'] : '',
				'jsonld' => $s['jsonld'],
			];
		}

		$target = self::resolve_target( $page_url );
		if ( $target === null ) {
			return new WP_Error( 'not_found', "Could not resolve a post for URL: {$page_url}", [ 'status' => 404 ] );
		}

		self::store( $target, $clean );

		return new WP_REST_Response( [
			'success' => true,
			'target'  => $target,
			'count'   => count( $clean ),
		], 200 );
	}

	public static function handle_get( WP_REST_Request $request ): WP_REST_Response|WP_Error {
		$page_url = (string) $request->get_param( 'pageUrl' );
		$target   = self::resolve_target( $page_url );
		if ( $target === null ) {
			return new WP_Error( 'not_found', "Could not resolve a post for URL: {$page_url}", [ 'status' => 404 ] );
		}
		return new WP_REST_Response( [
			'target'  => $target,
			'schemas' => self::load( $target ),
		], 200 );
	}

	public static function handle_delete( WP_REST_Request $request ): WP_REST_Response|WP_Error {
		$page_url = (string) $request->get_param( 'pageUrl' );
		$target   = self::resolve_target( $page_url );
		if ( $target === null ) {
			return new WP_Error( 'not_found', "Could not resolve a post for URL: {$page_url}", [ 'status' => 404 ] );
		}
		self::store( $target, [] );
		return new WP_REST_Response( [ 'success' => true, 'target' => $target ], 200 );
	}

	// ── Storage ───────────────────────────────────────────────────────────────

	/** @return array{type:string,id?:int} */
	private static function resolve_target( string $url ): ?array {
		$id = Poirier_API::resolve_post_id( $url );
		if ( $id === 'homepage' ) return [ 'type' => 'home' ];
		if ( is_int( $id ) && $id > 0 ) return [ 'type' => 'post', 'id' => $id ];
		return null;
	}

	/** @param array{type:string,id?:int} $target */
	private static function store( array $target, array $schemas ): void {
		$json = wp_json_encode( array_values( $schemas ) );
		if ( $target['type'] === 'home' ) {
			update_option( self::HOME_OPTION, $json );
		} else {
			update_post_meta( $target['id'], self::META_KEY, wp_slash( $json ) );
		}
	}

	/** @param array{type:string,id?:int} $target @return array<int,array> */
	private static function load( array $target ): array {
		$json = $target['type'] === 'home'
			? (string) get_option( self::HOME_OPTION, '' )
			: (string) get_post_meta( $target['id'], self::META_KEY, true );
		if ( $json === '' ) return [];
		$decoded = json_decode( $json, true );
		return is_array( $decoded ) ? $decoded : [];
	}

	// ── Rendering (buffer the head, dedup, append ours last) ─────────────────────

	private static function get_managed_for_current(): array {
		if ( self::$managed_cache !== null ) return self::$managed_cache;

		$target = null;
		if ( is_front_page() || is_home() ) {
			$target = [ 'type' => 'home' ];
		} else {
			$id = get_queried_object_id();
			if ( $id ) $target = [ 'type' => 'post', 'id' => (int) $id ];
		}

		self::$managed_cache = $target ? self::load( $target ) : [];
		return self::$managed_cache;
	}

	public static function maybe_start_buffer(): void {
		if ( empty( self::get_managed_for_current() ) ) return;
		self::$buffering = true;
		ob_start();
	}

	public static function flush_buffer(): void {
		if ( ! self::$buffering ) return;
		self::$buffering = false;

		$html    = (string) ob_get_clean();
		$managed = self::get_managed_for_current();

		// CMS is the single source of truth for managed pages: strip EVERY other
		// (non-CMS) JSON-LD block from the head, then render only our schemas.
		echo self::strip_foreign( $html );
		echo self::render_scripts( $managed );
	}

	/**
	 * Remove every <script type="application/ld+json"> block that is NOT ours
	 * (class="poirier-schema"). Used when the CMS manages the page's schema, so
	 * Yoast / other plugins / theme structured data is fully replaced by the CMS.
	 */
	public static function strip_foreign( string $html ): string {
		return (string) preg_replace_callback(
			'#<script\b[^>]*type=(["\'])application/ld\+json\1[^>]*>(.*?)</script>#is',
			static function ( array $m ): string {
				return stripos( $m[0], 'poirier-schema' ) !== false ? $m[0] : '';
			},
			$html
		);
	}

	/** Render the managed schemas as tagged inline JSON-LD scripts. */
	public static function render_scripts( array $managed ): string {
		$out = '';
		foreach ( $managed as $entry ) {
			if ( ! isset( $entry['jsonld'] ) ) continue;
			$out .= "\n" . '<script type="application/ld+json" class="poirier-schema">'
				. self::encode_inline( $entry['jsonld'] ) . '</script>';
		}
		return $out . "\n";
	}

	// ── Helpers ──────────────────────────────────────────────────────────────────

	/** JSON-encode for inline <script>, neutralising </script> breakouts. */
	private static function encode_inline( $value ): string {
		// JSON_HEX_TAG/AMP escape <, >, & as < etc. — XSS-safe inside <script>.
		$json = wp_json_encode( $value, JSON_HEX_TAG | JSON_HEX_AMP | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE );
		return $json === false ? '{}' : $json;
	}
}
