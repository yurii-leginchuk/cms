<?php
declare(strict_types=1);

if ( ! defined( 'ABSPATH' ) ) exit;

class Poirier_API {

	private const NAMESPACE = 'poirier-cms/v1';
	private const ROUTE     = '/update-meta';

	public static function register_routes(): void {
		register_rest_route( self::NAMESPACE, '/ping', [
			'methods'             => 'GET',
			'callback'            => [ self::class, 'handle_ping' ],
			'permission_callback' => [ self::class, 'authenticate' ],
		] );

		register_rest_route( self::NAMESPACE, self::ROUTE, [
			'methods'             => 'POST',
			'callback'            => [ self::class, 'handle_update_meta' ],
			'permission_callback' => [ self::class, 'authenticate' ],
			'args'                => [
				'pageUrl' => [
					'required'          => true,
					'type'              => 'string',
					'sanitize_callback' => 'esc_url_raw',
				],
				// All meta fields are optional. A field ABSENT from the body is
				// left untouched in Yoast; a field present-but-empty/null resets
				// it to the Yoast default (delete_post_meta). See handle_update_meta.
				'metaTitle'          => [ 'required' => false, 'type' => [ 'string', 'null' ] ],
				'metaDescription'    => [ 'required' => false, 'type' => [ 'string', 'null' ] ],
				'metaRobotsNoindex'  => [ 'required' => false, 'type' => [ 'string', 'null' ] ],
				'metaRobotsNofollow' => [ 'required' => false, 'type' => [ 'string', 'null' ] ],
				'canonical'          => [ 'required' => false, 'type' => [ 'string', 'null' ] ],
				'ogTitle'            => [ 'required' => false, 'type' => [ 'string', 'null' ] ],
				'ogDescription'      => [ 'required' => false, 'type' => [ 'string', 'null' ] ],
				'ogImage'            => [ 'required' => false, 'type' => [ 'string', 'null' ] ],
				'ogImageId'          => [ 'required' => false, 'type' => [ 'integer', 'null' ] ],
			],
		] );
	}

	/**
	 * Yoast post-meta keys for the simple (single-key) fields. Open Graph image
	 * is handled separately because it spans two keys (URL + attachment id).
	 */
	private const META_FIELDS = [
		'metaTitle'          => '_yoast_wpseo_title',
		'metaDescription'    => '_yoast_wpseo_metadesc',
		'metaRobotsNoindex'  => '_yoast_wpseo_meta-robots-noindex',
		'metaRobotsNofollow' => '_yoast_wpseo_meta-robots-nofollow',
		'canonical'          => '_yoast_wpseo_canonical',
		'ogTitle'            => '_yoast_wpseo_opengraph-title',
		'ogDescription'      => '_yoast_wpseo_opengraph-description',
	];

	private const OG_IMAGE_KEY    = '_yoast_wpseo_opengraph-image';
	private const OG_IMAGE_ID_KEY = '_yoast_wpseo_opengraph-image-id';

	/**
	 * Pure write-decision for one field. Kept side-effect-free so it can be unit
	 * tested without a WordPress runtime (see tests/yoast-meta-write-test.php).
	 *
	 *  - absent from body            → 'skip'   (leave Yoast's value untouched)
	 *  - present, empty string/null  → 'delete' (reset to the Yoast default)
	 *  - present, non-empty value    → 'set'
	 *
	 * @return array{action:string, value?:mixed}
	 */
	public static function resolve_meta_write( bool $present, mixed $value ): array {
		if ( ! $present ) {
			return [ 'action' => 'skip' ];
		}
		if ( $value === null || $value === '' ) {
			return [ 'action' => 'delete' ];
		}
		return [ 'action' => 'set', 'value' => $value ];
	}

	/**
	 * Pure write-decision for the Open Graph image (URL + optional attachment id
	 * travel together). Side-effect-free so the present/empty/absent tri-state
	 * and the library-vs-external id handling can be unit tested without a
	 * WordPress runtime (see tests/yoast-meta-write-test.php).
	 *
	 *  - ogImage absent              → 'skip'  (leave Yoast untouched)
	 *  - ogImage present, empty/null → 'clear' (delete URL + id, reset to default)
	 *  - ogImage present with a URL  → 'set' with:
	 *        id > 0  → a library image: persist the attachment id into Yoast
	 *        id == 0 → an external URL: clear any stale attachment id
	 *
	 * @return array{action:string, url?:string, id?:int}
	 */
	public static function resolve_og_image_write(
		bool $og_present,
		mixed $og_value,
		bool $id_present,
		mixed $id_value
	): array {
		$og = self::resolve_meta_write( $og_present, $og_value );

		if ( $og['action'] === 'skip' ) {
			return [ 'action' => 'skip' ];
		}
		if ( $og['action'] === 'delete' ) {
			return [ 'action' => 'clear' ];
		}

		$id = ( $id_present && $id_value !== null && (int) $id_value > 0 ) ? (int) $id_value : 0;
		return [ 'action' => 'set', 'url' => (string) $og['value'], 'id' => $id ];
	}

	public static function handle_ping(): WP_REST_Response {
		return new WP_REST_Response( [
			'ok'     => true,
			'plugin' => 'poirier-cms',
			'yoast'  => self::yoast_is_active(),
		], 200 );
	}

	// ── Authentication ──────────────────────────────────────────────────────────

	public static function authenticate( WP_REST_Request $request ): bool|WP_Error {
		$provided = (string) $request->get_header( 'X-Poirier-API-Key' );
		$stored   = (string) get_option( POIRIER_CMS_OPTION_KEY, '' );

		if ( empty( $stored ) || ! hash_equals( $stored, $provided ) ) {
			self::log_request( $request, null, 'auth_failed' );
			return new WP_Error( 'unauthorized', 'Invalid or missing API key.', [ 'status' => 401 ] );
		}

		return true;
	}

	// ── Main handler ────────────────────────────────────────────────────────────

	public static function handle_update_meta( WP_REST_Request $request ): WP_REST_Response|WP_Error {
		if ( ! self::yoast_is_active() ) {
			return new WP_Error(
				'yoast_missing',
				'Yoast SEO plugin is not active on this site.',
				[ 'status' => 500 ]
			);
		}

		$page_url = (string) $request->get_param( 'pageUrl' );
		$body     = $request->get_json_params() ?? [];

		// ── Resolve URL → post ID ───────────────────────────────────────────────
		$post_id = self::resolve_post_id( $page_url );

		if ( $post_id === 'homepage' ) {
			$result = self::update_homepage_meta( $body );
			self::log_request( $request, null, 'ok', 'homepage' );
			return new WP_REST_Response( $result, 200 );
		}

		if ( ! $post_id ) {
			self::log_request( $request, null, 'not_found' );
			return new WP_Error(
				'not_found',
				"Could not resolve a post for URL: {$page_url}",
				[ 'status' => 404 ]
			);
		}

		$post = get_post( $post_id );
		if ( ! $post ) {
			return new WP_Error( 'not_found', "Post {$post_id} not found.", [ 'status' => 404 ] );
		}

		// ── Apply Yoast meta + read back ────────────────────────────────────────
		$updated = self::apply_meta_to_post( (int) $post_id, $body );
		$stored  = self::read_back( (int) $post_id );

		$response = [
			'success'   => true,
			'postId'    => $post_id,
			'postType'  => $post->post_type,
			'postTitle' => $post->post_title,
			'updated'   => $updated,
			'stored'    => $stored,
		];

		self::log_request( $request, $post_id, 'ok' );

		return new WP_REST_Response( $response, 200 );
	}

	/**
	 * Apply every supported field to a post's Yoast meta, honouring the
	 * present/empty/absent tri-state. Title & description keep their legacy
	 * "write empty string" behaviour (Yoast treats '' as no override); robots,
	 * canonical and Open Graph fields are DELETED on empty so the page truly
	 * returns to the Yoast default. Returns the map of fields actually touched.
	 */
	private static function apply_meta_to_post( int $post_id, array $body ): array {
		$updated = [];

		foreach ( self::META_FIELDS as $param => $meta_key ) {
			$decision = self::resolve_meta_write( array_key_exists( $param, $body ), $body[ $param ] ?? null );

			// Title/description: empty means "no override" → store '' (legacy behaviour).
			$empty_is_blank = in_array( $param, [ 'metaTitle', 'metaDescription' ], true );

			if ( $decision['action'] === 'set' ) {
				$value = self::sanitize_field( $param, (string) $decision['value'] );
				update_post_meta( $post_id, $meta_key, $value );
				$updated[ $param ] = $value;
			} elseif ( $decision['action'] === 'delete' ) {
				if ( $empty_is_blank ) {
					update_post_meta( $post_id, $meta_key, '' );
					$updated[ $param ] = '';
				} else {
					delete_post_meta( $post_id, $meta_key );
					$updated[ $param ] = null;
				}
			}
		}

		// ── Open Graph image (URL + attachment id together) ─────────────────────
		$og = self::resolve_og_image_write(
			array_key_exists( 'ogImage', $body ),   $body['ogImage'] ?? null,
			array_key_exists( 'ogImageId', $body ), $body['ogImageId'] ?? null
		);

		if ( $og['action'] === 'set' ) {
			$url = esc_url_raw( $og['url'] );
			update_post_meta( $post_id, self::OG_IMAGE_KEY, $url );
			$updated['ogImage'] = $url;

			if ( $og['id'] > 0 ) {
				// Library image. Yoast hooks `sanitize_post_meta_<key>` to BLANK the
				// `-image-id` post-meta on write, and its indexable rebuild then
				// resets the id from that now-empty post-meta. So: drop that filter
				// for THIS request (filters reset next request) so the id actually
				// persists, AND mirror it straight into the indexable. Together
				// these make Yoast emit og:image:width / og:image:height.
				self::unhook_og_image_id_sanitizer();
				update_post_meta( $post_id, self::OG_IMAGE_ID_KEY, $og['id'] );
				self::set_yoast_indexable_og_image( $post_id, $url, $og['id'] );
				$updated['ogImageId'] = $og['id'];
			} else {
				// External URL — clear any stale attachment id (post-meta AND the
				// indexable) so Yoast never regenerates from an old attachment.
				delete_post_meta( $post_id, self::OG_IMAGE_ID_KEY );
				self::set_yoast_indexable_og_image( $post_id, $url, 0 );
				$updated['ogImageId'] = null;
			}
		} elseif ( $og['action'] === 'clear' ) {
			delete_post_meta( $post_id, self::OG_IMAGE_KEY );
			delete_post_meta( $post_id, self::OG_IMAGE_ID_KEY );
			self::clear_yoast_indexable_og_image( $post_id );
			$updated['ogImage']   = null;
			$updated['ogImageId'] = null;
		}

		return $updated;
	}

	/** Field-appropriate sanitiser for a value being written. */
	private static function sanitize_field( string $param, string $value ): string {
		switch ( $param ) {
			case 'canonical':
				return esc_url_raw( $value );
			case 'metaDescription':
			case 'ogDescription':
				return sanitize_textarea_field( $value );
			default:
				return sanitize_text_field( $value );
		}
	}

	/** Re-read the stored Yoast meta so the CMS can prove what actually landed. */
	private static function read_back( int $post_id ): array {
		$stored = [];
		foreach ( self::META_FIELDS as $param => $meta_key ) {
			$stored[ $param ] = get_post_meta( $post_id, $meta_key, true );
		}
		$stored['ogImage']   = get_post_meta( $post_id, self::OG_IMAGE_KEY, true );
		$stored['ogImageId'] = get_post_meta( $post_id, self::OG_IMAGE_ID_KEY, true );
		return $stored;
	}

	// ── Yoast Open Graph image indexable ────────────────────────────────────────

	/**
	 * Load (creating if needed) the Yoast indexable row for a post. Returns null
	 * when Yoast's indexable layer isn't available, so callers degrade to the
	 * URL-only og:image rendered from post-meta.
	 */
	private static function yoast_indexable_for_post( int $post_id ): ?object {
		if ( ! function_exists( 'YoastSEO' ) ) {
			return null;
		}
		try {
			$repo = YoastSEO()->classes->get(
				\Yoast\WP\SEO\Repositories\Indexable_Repository::class
			);
			$indexable = $repo->find_by_id_and_type( $post_id, 'post' );
			return $indexable ?: null;
		} catch ( \Throwable $e ) {
			return null;
		}
	}

	/**
	 * Remove Yoast's sanitize filter that blanks `_yoast_wpseo_opengraph-image-id`
	 * on write. WordPress applies `sanitize_post_meta_{$key}` inside
	 * update_post_meta(); dropping it lets the attachment id persist. Affects only
	 * the current request — Yoast re-registers the filter on the next bootstrap.
	 */
	private static function unhook_og_image_id_sanitizer(): void {
		remove_all_filters( 'sanitize_post_meta_' . self::OG_IMAGE_ID_KEY );
	}

	/**
	 * Write the Open Graph image into the Yoast indexable. For a library image
	 * ($attachment_id > 0) Yoast emits og:image:width/height by reading the
	 * attachment behind `open_graph_image_id`; for an external URL ($attachment_id
	 * == 0) we still set the URL but null the id so no stale dimensions are emitted.
	 *
	 * Runs AFTER the post-meta write so it wins over any indexable Yoast rebuilds
	 * from that post-meta during the same request.
	 */
	private static function set_yoast_indexable_og_image( int $post_id, string $url, int $attachment_id ): void {
		$indexable = self::yoast_indexable_for_post( $post_id );
		if ( ! $indexable ) {
			return;
		}
		try {
			$indexable->open_graph_image        = $url;
			$indexable->open_graph_image_id     = $attachment_id > 0 ? $attachment_id : null;
			$indexable->open_graph_image_source = 'set-by-user';
			// Leave the dimension meta to Yoast — it regenerates width/height from
			// the attachment id at render time (mirrors Yoast's own behaviour).
			$indexable->open_graph_image_meta   = null;
			$indexable->save();
		} catch ( \Throwable $e ) {
			// Best-effort: og:image still renders from the URL post-meta.
		}
	}

	/** Clear the Open Graph image from the Yoast indexable (mirrors a delete). */
	private static function clear_yoast_indexable_og_image( int $post_id ): void {
		$indexable = self::yoast_indexable_for_post( $post_id );
		if ( ! $indexable ) {
			return;
		}
		try {
			$indexable->open_graph_image        = null;
			$indexable->open_graph_image_id     = null;
			$indexable->open_graph_image_source = null;
			$indexable->open_graph_image_meta   = null;
			$indexable->save();
		} catch ( \Throwable $e ) {
			// Best-effort.
		}
	}

	// ── Homepage Yoast meta ─────────────────────────────────────────────────────

	/**
	 * A static front page is a real post → full field support via post-meta.
	 * A posts-page homepage has no per-post home; only title/description live in
	 * the `wpseo_titles` option, so robots/canonical/OG are intentionally NOT
	 * written there (the CMS disables them for that case).
	 */
	private static function update_homepage_meta( array $body ): array {
		$front_id = (int) get_option( 'page_on_front' );

		if ( $front_id > 0 ) {
			$updated = self::apply_meta_to_post( $front_id, $body );
			return [
				'success' => true,
				'type'    => 'homepage',
				'postId'  => $front_id,
				'updated' => $updated,
				'stored'  => self::read_back( $front_id ),
			];
		}

		// Posts-page homepage — only title/description, stored in wpseo_titles.
		$wpseo_titles = (array) get_option( 'wpseo_titles', [] );
		$updated      = [];

		$title = self::resolve_meta_write( array_key_exists( 'metaTitle', $body ), $body['metaTitle'] ?? null );
		if ( $title['action'] !== 'skip' ) {
			$wpseo_titles['title-home-wpseo'] = $title['action'] === 'set'
				? sanitize_text_field( (string) $title['value'] ) : '';
			$updated['metaTitle'] = $wpseo_titles['title-home-wpseo'];
		}

		$desc = self::resolve_meta_write( array_key_exists( 'metaDescription', $body ), $body['metaDescription'] ?? null );
		if ( $desc['action'] !== 'skip' ) {
			$wpseo_titles['metadesc-home-wpseo'] = $desc['action'] === 'set'
				? sanitize_textarea_field( (string) $desc['value'] ) : '';
			$updated['metaDescription'] = $wpseo_titles['metadesc-home-wpseo'];
		}

		update_option( 'wpseo_titles', $wpseo_titles );

		return [ 'success' => true, 'type' => 'homepage', 'updated' => $updated ];
	}

	// ── URL → Post ID resolution ────────────────────────────────────────────────

	/**
	 * Returns a post ID (int), 'homepage' (string), or null if not found.
	 * Public so the schema module can reuse the same URL→post resolution.
	 */
	public static function resolve_post_id( string $url ): int|string|null {
		$front_id = (int) get_option( 'page_on_front' );

		// 1. Post-identifying query vars (?p=, ?page_id=, ?attachment_id=) must be
		//    resolved BEFORE the home-URL comparison: stripping the query string
		//    (below) would otherwise make e.g. "https://site/?p=123" — the permalink
		//    of a post without a pretty URL — look identical to the homepage.
		$query_id = self::post_id_from_query( $url );
		if ( $query_id !== null ) {
			return ( $front_id > 0 && $query_id === $front_id ) ? 'homepage' : $query_id;
		}

		// 2. The bare home URL (path only, no identifying query) is the homepage.
		$url_normalised  = trailingslashit( strtok( $url, '?' ) );
		$home_normalised = trailingslashit( home_url() );
		if ( $url_normalised === $home_normalised ) {
			return 'homepage';
		}

		// 3. WP's built-in resolver (handles pages, posts, CPTs by pretty permalink)
		$post_id = url_to_postid( $url );
		if ( $post_id > 0 ) {
			// A pretty permalink pointing at the static front page is the homepage,
			// so its schema/meta round-trips through the same storage as "/".
			return ( $front_id > 0 && $post_id === $front_id ) ? 'homepage' : $post_id;
		}

		// 4. Fallback: query by guid (covers some edge cases with custom URLs)
		global $wpdb;
		$post_id = (int) $wpdb->get_var( $wpdb->prepare(
			"SELECT ID FROM {$wpdb->posts}
			 WHERE post_status = 'publish'
			   AND (guid = %s OR guid = %s)
			 LIMIT 1",
			$url,
			untrailingslashit( $url )
		) );

		return $post_id > 0 ? $post_id : null;
	}

	/**
	 * Extract a post ID from WordPress's identifying query vars (?p=, ?page_id=,
	 * ?attachment_id=). Pure string parsing that mirrors url_to_postid()'s own
	 * leading check, so query-string permalinks resolve correctly. Returns null
	 * when no such var is present or it isn't a positive integer.
	 */
	private static function post_id_from_query( string $url ): ?int {
		$query = (string) parse_url( $url, PHP_URL_QUERY );
		if ( $query === '' ) {
			return null;
		}
		parse_str( $query, $vars );
		foreach ( [ 'p', 'page_id', 'attachment_id' ] as $key ) {
			if ( isset( $vars[ $key ] ) && ctype_digit( (string) $vars[ $key ] ) ) {
				$id = (int) $vars[ $key ];
				if ( $id > 0 ) {
					return $id;
				}
			}
		}
		return null;
	}

	// ── Helpers ─────────────────────────────────────────────────────────────────

	private static function yoast_is_active(): bool {
		return defined( 'WPSEO_VERSION' );
	}

	/**
	 * Keeps a rolling log of the last N requests for the admin panel.
	 */
	private static function log_request(
		WP_REST_Request $request,
		?int   $post_id,
		string $outcome,
		string $type = 'post'
	): void {
		$log = (array) get_option( POIRIER_CMS_LOG_OPTION, [] );

		array_unshift( $log, [
			'time'    => current_time( 'mysql' ),
			'url'     => (string) $request->get_param( 'pageUrl' ),
			'outcome' => $outcome,
			'type'    => $type,
			'postId'  => $post_id,
		] );

		// Keep only the most recent entries
		if ( count( $log ) > POIRIER_CMS_LOG_LIMIT ) {
			$log = array_slice( $log, 0, POIRIER_CMS_LOG_LIMIT );
		}

		update_option( POIRIER_CMS_LOG_OPTION, $log );
	}
}
