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
	}

	/**
	 * Targeted rewrite filters (preferred over full-page output buffering).
	 * Each short-circuits on the kill-switch, then rewrites only on a verified hit.
	 */
	public static function register_render_hooks(): void {
		add_filter( 'wp_get_attachment_image_src', [ self::class, 'filter_attachment_image_src' ], 20, 4 );
		add_filter( 'wp_calculate_image_srcset', [ self::class, 'filter_srcset' ], 20, 5 );
		add_filter( 'wp_content_img_tag', [ self::class, 'filter_content_img_tag' ], 20, 3 );
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
			'plugin'  => 'poirier-cms',
			'enabled' => self::is_enabled(),
			'mapped'  => count( self::get_map() ),
		], 200 );
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
