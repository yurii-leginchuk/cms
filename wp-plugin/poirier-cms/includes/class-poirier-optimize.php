<?php
/**
 * Poirier CMS — image optimization / CDN URL rewrite (Phase 3).
 *
 * Receives VERIFIED {attachmentId → cdnUrl} mappings from the CMS and rewrites
 * image URLs to the CDN at render time. Safety guarantees:
 *
 *   1. Rewrites ONLY on a verified map hit for that attachment id — an image
 *      without a mapping ALWAYS keeps its original WordPress URL (graceful
 *      degradation is the default code path, not an error branch).
 *   2. A master kill-switch (`poirier_cms_optimize_enabled` option): when off,
 *      every filter returns the content untouched.
 *   3. The kill-switch DELETES NOTHING — it only stops rewriting.
 *
 * The rewrite logic lives in PURE static methods so it is unit-tested without a
 * WordPress runtime (tests/cdn-rewrite-test.php).
 */

declare(strict_types=1);

if ( ! defined( 'ABSPATH' ) ) exit;

class Poirier_Optimize {

	private const NAMESPACE = 'poirier-cms/v1';

	/** Option: map of [ (int) attachmentId => (string) cdnUrl ]. */
	public const OPTION_MAP = 'poirier_cms_cdn_map';
	/** Option: master rewrite kill-switch (bool). */
	public const OPTION_TOGGLE = 'poirier_cms_optimize_enabled';
	/** Options: new-upload webhook config. */
	public const OPTION_WEBHOOK_URL     = 'poirier_cms_webhook_url';
	public const OPTION_WEBHOOK_SECRET  = 'poirier_cms_webhook_secret';
	public const OPTION_WEBHOOK_ENABLED = 'poirier_cms_webhook_enabled';

	/** In-request guard so a new attachment fires the webhook at most once. */
	private static $fired = [];

	public static function register_routes(): void {
		register_rest_route( self::NAMESPACE, '/cdn-map', [
			'methods'             => 'POST',
			'callback'            => [ self::class, 'handle_cdn_map' ],
			'permission_callback' => [ 'Poirier_API', 'authenticate' ],
		] );
		register_rest_route( self::NAMESPACE, '/optimize-toggle', [
			'methods'             => 'POST',
			'callback'            => [ self::class, 'handle_toggle' ],
			'permission_callback' => [ 'Poirier_API', 'authenticate' ],
		] );
		register_rest_route( self::NAMESPACE, '/optimize-status', [
			'methods'             => 'GET',
			'callback'            => [ self::class, 'handle_status' ],
			'permission_callback' => [ 'Poirier_API', 'authenticate' ],
		] );
		register_rest_route( self::NAMESPACE, '/webhook-config', [
			'methods'             => 'POST',
			'callback'            => [ self::class, 'handle_webhook_config' ],
			'permission_callback' => [ 'Poirier_API', 'authenticate' ],
		] );
	}

	/**
	 * Targeted rewrite filters (preferred over full-page output buffering).
	 * Each short-circuits on the kill-switch, then rewrites only on a verified hit.
	 */
	public static function register_render_hooks(): void {
		add_filter( 'wp_get_attachment_image_src', [ self::class, 'filter_attachment_image_src' ], 20, 4 );
		add_filter( 'wp_calculate_image_srcset', [ self::class, 'filter_srcset' ], 20, 5 );
		add_filter( 'wp_content_img_tag', [ self::class, 'filter_content_img_tag' ], 20, 3 );

		// New-upload webhook: fire when a new attachment is added. add_attachment
		// gives us the id (file already on disk); wp_generate_attachment_metadata
		// runs after sizes are generated. A per-request guard fires at most once.
		add_action( 'add_attachment', [ self::class, 'on_new_attachment' ] );
		add_filter( 'wp_generate_attachment_metadata', [ self::class, 'on_generate_metadata' ], 10, 2 );
	}

	// ── State ────────────────────────────────────────────────────────────────

	public static function is_enabled(): bool {
		return (bool) get_option( self::OPTION_TOGGLE, false );
	}

	/** @return array<int,string> */
	public static function get_map(): array {
		$map = get_option( self::OPTION_MAP, [] );
		return is_array( $map ) ? $map : [];
	}

	// ── REST handlers (API-key gated) ─────────────────────────────────────────

	public static function handle_cdn_map( WP_REST_Request $request ): WP_REST_Response {
		$mappings = $request->get_param( 'mappings' );
		$existing = self::get_map();
		$upserted = 0;

		if ( is_array( $mappings ) ) {
			foreach ( $mappings as $m ) {
				$id  = isset( $m['wpAttachmentId'] ) ? (int) $m['wpAttachmentId'] : 0;
				$url = isset( $m['cdnUrl'] ) ? esc_url_raw( (string) $m['cdnUrl'] ) : '';
				if ( $id > 0 && $url !== '' ) {
					$existing[ $id ] = $url;
					$upserted++;
				}
			}
		}

		update_option( self::OPTION_MAP, $existing );
		return new WP_REST_Response( [
			'success'  => true,
			'upserted' => $upserted,
			'total'    => count( $existing ),
		], 200 );
	}

	public static function handle_toggle( WP_REST_Request $request ): WP_REST_Response {
		$enabled = (bool) $request->get_param( 'enabled' );
		update_option( self::OPTION_TOGGLE, $enabled );
		return new WP_REST_Response( [ 'success' => true, 'enabled' => $enabled ], 200 );
	}

	public static function handle_status(): WP_REST_Response {
		return new WP_REST_Response( [
			'plugin'         => 'poirier-cms',
			'enabled'        => self::is_enabled(),
			'mapped'         => count( self::get_map() ),
			'webhookEnabled' => (bool) get_option( self::OPTION_WEBHOOK_ENABLED, false ),
		], 200 );
	}

	/** Store the CMS-provided webhook config (callback URL + secret + enabled). */
	public static function handle_webhook_config( WP_REST_Request $request ): WP_REST_Response {
		$url     = (string) $request->get_param( 'callbackUrl' );
		$secret  = (string) $request->get_param( 'secret' );
		$enabled = (bool) $request->get_param( 'enabled' );

		if ( $url !== '' ) update_option( self::OPTION_WEBHOOK_URL, esc_url_raw( $url ) );
		if ( $secret !== '' ) update_option( self::OPTION_WEBHOOK_SECRET, $secret );
		update_option( self::OPTION_WEBHOOK_ENABLED, $enabled );

		return new WP_REST_Response( [ 'success' => true, 'enabled' => $enabled ], 200 );
	}

	// ── New-upload webhook (plugin → CMS) ──────────────────────────────────────

	/**
	 * PURE predicate: should the webhook fire? Requires the master switch on, the
	 * webhook enabled, AND a URL + secret configured. Kept side-effect-free so the
	 * kill-switch behaviour is unit tested without a WordPress runtime.
	 */
	public static function should_fire( bool $master_on, bool $webhook_enabled, string $url, string $secret ): bool {
		return $master_on && $webhook_enabled && $url !== '' && $secret !== '';
	}

	/**
	 * PURE builder: the non-blocking wp_remote_post args. blocking=false + a short
	 * timeout so the upload is never slowed; the secret travels in a header.
	 *
	 * @return array<string,mixed>
	 */
	public static function build_webhook_request( int $attachment_id, string $url, string $secret ): array {
		return [
			'url'  => $url,
			'args' => [
				'blocking' => false,
				'timeout'  => 1,
				'headers'  => [
					'Content-Type'            => 'application/json',
					'X-Poirier-Webhook-Secret' => $secret,
				],
				'body'     => wp_json_encode( [ 'attachmentId' => $attachment_id ] ),
			],
		];
	}

	public static function on_new_attachment( $attachment_id ): void {
		self::maybe_fire_webhook( (int) $attachment_id );
	}

	/** @param mixed $metadata @return mixed */
	public static function on_generate_metadata( $metadata, $attachment_id ) {
		self::maybe_fire_webhook( (int) $attachment_id );
		return $metadata;
	}

	private static function maybe_fire_webhook( int $attachment_id ): void {
		if ( $attachment_id <= 0 || isset( self::$fired[ $attachment_id ] ) ) return;
		if ( ! wp_attachment_is_image( $attachment_id ) ) return;

		$master   = self::is_enabled();
		$enabled  = (bool) get_option( self::OPTION_WEBHOOK_ENABLED, false );
		$url      = (string) get_option( self::OPTION_WEBHOOK_URL, '' );
		$secret   = (string) get_option( self::OPTION_WEBHOOK_SECRET, '' );

		if ( ! self::should_fire( $master, $enabled, $url, $secret ) ) return;

		self::$fired[ $attachment_id ] = true;
		$req = self::build_webhook_request( $attachment_id, $url, $secret );
		wp_remote_post( $req['url'], $req['args'] ); // non-blocking — never slows the upload
	}

	// ── Pure rewriters (no WP runtime — unit tested) ───────────────────────────

	/**
	 * Rewrite the URL in wp_get_attachment_image_src's [url,w,h,is_intermediate]
	 * array. Only when enabled AND a mapping exists; otherwise returned untouched.
	 *
	 * @param mixed $image
	 * @param array<int,string> $map
	 * @return mixed
	 */
	public static function rewrite_src_array( $image, int $attachment_id, array $map, bool $enabled ) {
		if ( ! $enabled ) return $image;
		if ( ! is_array( $image ) || ! isset( $image[0] ) ) return $image;
		if ( ! isset( $map[ $attachment_id ] ) ) return $image;
		$image[0] = (string) $map[ $attachment_id ];
		return $image;
	}

	/**
	 * For a mapped attachment we serve a single optimized object, so we DROP the
	 * srcset (return []) and let the browser use the rewritten CDN src. Never
	 * breaks the image. Untouched when disabled or unmapped.
	 *
	 * @param array<int|string,mixed> $sources
	 * @param array<int,string> $map
	 * @return array<int|string,mixed>
	 */
	public static function rewrite_srcset( array $sources, int $attachment_id, array $map, bool $enabled ): array {
		if ( ! $enabled ) return $sources;
		if ( ! isset( $map[ $attachment_id ] ) ) return $sources;
		return [];
	}

	/**
	 * Rewrite the <img> HTML from wp_content_img_tag: replace src with the CDN URL
	 * and strip srcset/sizes so the CDN src is used. Untouched when disabled or
	 * unmapped.
	 *
	 * @param array<int,string> $map
	 */
	public static function rewrite_content_img( string $html, int $attachment_id, array $map, bool $enabled ): string {
		if ( ! $enabled ) return $html;
		if ( ! isset( $map[ $attachment_id ] ) ) return $html;
		$cdn = esc_url_raw( (string) $map[ $attachment_id ] );

		$html = (string) preg_replace( '#\ssrc=(["\'])[^"\']*\1#i', ' src="' . $cdn . '"', $html, 1 );
		$html = (string) preg_replace( '#\ssrcset=(["\']).*?\1#i', '', $html );
		$html = (string) preg_replace( '#\ssizes=(["\']).*?\1#i', '', $html );
		return $html;
	}

	// ── WP filter wrappers ─────────────────────────────────────────────────────

	/** @param mixed $image @return mixed */
	public static function filter_attachment_image_src( $image, $attachment_id, $size = '', $icon = false ) {
		return self::rewrite_src_array( $image, (int) $attachment_id, self::get_map(), self::is_enabled() );
	}

	/**
	 * @param array<int|string,mixed> $sources
	 * @return array<int|string,mixed>
	 */
	public static function filter_srcset( $sources, $size_array = [], $image_src = '', $image_meta = [], $attachment_id = 0 ) {
		return self::rewrite_srcset( is_array( $sources ) ? $sources : [], (int) $attachment_id, self::get_map(), self::is_enabled() );
	}

	public static function filter_content_img_tag( $filtered_image, $context = '', $attachment_id = 0 ): string {
		return self::rewrite_content_img( (string) $filtered_image, (int) $attachment_id, self::get_map(), self::is_enabled() );
	}
}
