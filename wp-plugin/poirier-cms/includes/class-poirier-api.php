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
				'metaTitle' => [
					'required' => false,
					'type'     => [ 'string', 'null' ],
				],
				'metaDescription' => [
					'required' => false,
					'type'     => [ 'string', 'null' ],
				],
			],
		] );
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

		$page_url  = (string) $request->get_param( 'pageUrl' );
		$meta_title = $request->get_param( 'metaTitle' );
		$meta_desc  = $request->get_param( 'metaDescription' );

		// Normalise null vs missing
		$update_title = array_key_exists( 'metaTitle',       $request->get_json_params() ?? [] );
		$update_desc  = array_key_exists( 'metaDescription', $request->get_json_params() ?? [] );

		// ── Resolve URL → post ID ───────────────────────────────────────────────
		$post_id = self::resolve_post_id( $page_url );

		if ( $post_id === 'homepage' ) {
			$result = self::update_homepage_meta( $meta_title, $meta_desc, $update_title, $update_desc );
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

		// ── Apply Yoast meta ────────────────────────────────────────────────────
		$updated = [];

		if ( $update_title ) {
			$value = $meta_title !== null ? sanitize_text_field( (string) $meta_title ) : '';
			update_post_meta( $post_id, '_yoast_wpseo_title', $value );
			$updated['metaTitle'] = $value;
		}

		if ( $update_desc ) {
			$value = $meta_desc !== null ? sanitize_textarea_field( (string) $meta_desc ) : '';
			update_post_meta( $post_id, '_yoast_wpseo_metadesc', $value );
			$updated['metaDescription'] = $value;
		}

		$response = [
			'success'   => true,
			'postId'    => $post_id,
			'postType'  => $post->post_type,
			'postTitle' => $post->post_title,
			'updated'   => $updated,
		];

		self::log_request( $request, $post_id, 'ok' );

		return new WP_REST_Response( $response, 200 );
	}

	// ── Homepage Yoast meta ─────────────────────────────────────────────────────

	private static function update_homepage_meta(
		mixed $title,
		mixed $desc,
		bool  $update_title,
		bool  $update_desc
	): array {
		$front_id = (int) get_option( 'page_on_front' );
		$updated  = [];

		if ( $front_id > 0 ) {
			// Static front page — same as any other post
			if ( $update_title ) {
				$v = $title !== null ? sanitize_text_field( (string) $title ) : '';
				update_post_meta( $front_id, '_yoast_wpseo_title', $v );
				$updated['metaTitle'] = $v;
			}
			if ( $update_desc ) {
				$v = $desc !== null ? sanitize_textarea_field( (string) $desc ) : '';
				update_post_meta( $front_id, '_yoast_wpseo_metadesc', $v );
				$updated['metaDescription'] = $v;
			}
		} else {
			// Posts-page homepage — stored in wpseo_titles option
			$wpseo_titles = (array) get_option( 'wpseo_titles', [] );
			if ( $update_title ) {
				$wpseo_titles['title-home-wpseo']    = $title !== null ? sanitize_text_field( (string) $title ) : '';
				$updated['metaTitle'] = $wpseo_titles['title-home-wpseo'];
			}
			if ( $update_desc ) {
				$wpseo_titles['metadesc-home-wpseo'] = $desc !== null ? sanitize_textarea_field( (string) $desc ) : '';
				$updated['metaDescription'] = $wpseo_titles['metadesc-home-wpseo'];
			}
			update_option( 'wpseo_titles', $wpseo_titles );
		}

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
