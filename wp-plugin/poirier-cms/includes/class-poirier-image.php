<?php
/**
 * Poirier CMS — image ALT-text receiver.
 *
 * Receives one canonical image + its src variants from the CMS and writes the
 * alt text to the WordPress MEDIA ATTACHMENT (`_wp_attachment_image_alt`), which
 * is the single canonical alt field WP renders everywhere that image is used.
 *
 * Resolution order for the attachment id:
 *   1. an explicit wpAttachmentId from the CMS (when it later reconciles via the
 *      Media API);
 *   2. WP's attachment_url_to_postid() on each src variant + the canonical URL;
 *   3. a size-suffix-stripped retry (CMS already canonicalises, but live srcs
 *      may be resized variants like -300x200).
 *
 * If no attachment is found (external/CDN image, or one only present inline in
 * post HTML), we fall back to rewriting matching <img alt> in post content of
 * the page that references it — strictly, only when the src matches.
 */

declare(strict_types=1);

if ( ! defined( 'ABSPATH' ) ) exit;

class Poirier_Image {

	private const NAMESPACE = 'poirier-cms/v1';

	public static function register_routes(): void {
		register_rest_route( self::NAMESPACE, '/image-alt', [
			[
				'methods'             => 'POST',
				'callback'            => [ self::class, 'handle_set_alt' ],
				'permission_callback' => [ 'Poirier_API', 'authenticate' ],
			],
		] );

		// Authoritative media library listing — the CMS sources its image
		// inventory and current alt text from HERE (the WP media library), not
		// from scraping rendered pages.
		register_rest_route( self::NAMESPACE, '/media', [
			[
				'methods'             => 'GET',
				'callback'            => [ self::class, 'handle_list_media' ],
				'permission_callback' => [ 'Poirier_API', 'authenticate' ],
				'args'                => [
					'page'     => [ 'default' => 1 ],
					'per_page' => [ 'default' => 100 ],
				],
			],
		] );
	}

	/**
	 * List image attachments from the WP media library with their canonical alt
	 * text (`_wp_attachment_image_alt`). Paginated, ordered by ID for stable paging.
	 */
	public static function handle_list_media( WP_REST_Request $request ): WP_REST_Response {
		$page     = max( 1, (int) $request->get_param( 'page' ) );
		$per_page = (int) $request->get_param( 'per_page' );
		$per_page = $per_page > 0 ? min( 200, $per_page ) : 100;

		$query = new WP_Query( [
			'post_type'      => 'attachment',
			'post_status'    => 'inherit',
			'post_mime_type' => [ 'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml', 'image/avif' ],
			'posts_per_page' => $per_page,
			'paged'          => $page,
			'orderby'        => 'ID',
			'order'          => 'ASC',
			'fields'         => 'ids',
		] );

		$items = [];
		foreach ( (array) $query->posts as $id ) {
			$id  = (int) $id;
			$url = wp_get_attachment_url( $id );
			if ( ! $url ) continue;
			$alt = get_post_meta( $id, '_wp_attachment_image_alt', true );
			$items[] = [
				'id'      => $id,
				'url'     => (string) $url,
				'alt'     => is_string( $alt ) ? $alt : '',
				'altSet'  => metadata_exists( 'post', $id, '_wp_attachment_image_alt' ),
				'mime'    => (string) get_post_mime_type( $id ),
				'title'   => (string) get_the_title( $id ),
			];
		}

		return new WP_REST_Response( [
			'page'       => $page,
			'perPage'    => $per_page,
			'total'      => (int) $query->found_posts,
			'totalPages' => (int) $query->max_num_pages,
			'items'      => $items,
		], 200 );
	}

	public static function handle_set_alt( WP_REST_Request $request ): WP_REST_Response|WP_Error {
		$canonical = (string) $request->get_param( 'canonicalUrl' );
		$variants  = $request->get_param( 'srcVariants' );
		$att_hint  = $request->get_param( 'wpAttachmentId' );
		$alt       = $request->get_param( 'alt' );
		$alt       = $alt === null ? '' : sanitize_text_field( (string) $alt );

		$candidates = [];
		if ( is_array( $variants ) ) {
			foreach ( $variants as $v ) $candidates[] = (string) $v;
		}
		if ( $canonical !== '' ) $candidates[] = $canonical;

		$attachment_id = self::resolve_attachment_id( $att_hint, $candidates );

		if ( $attachment_id > 0 ) {
			update_post_meta( $attachment_id, '_wp_attachment_image_alt', $alt );
			return new WP_REST_Response( [
				'success'      => true,
				'mode'         => 'attachment',
				'attachmentId' => $attachment_id,
			], 200 );
		}

		// Fallback: rewrite inline <img alt> wherever this src appears in content.
		$rewritten = self::rewrite_inline_alt( $candidates, $alt );
		return new WP_REST_Response( [
			'success'   => true,
			'mode'      => 'inline',
			'rewritten' => $rewritten,
		], 200 );
	}

	/** @param array<int,string> $candidates */
	private static function resolve_attachment_id( $hint, array $candidates ): int {
		if ( is_numeric( $hint ) && (int) $hint > 0 ) {
			$p = get_post( (int) $hint );
			if ( $p && $p->post_type === 'attachment' ) return (int) $hint;
		}
		foreach ( $candidates as $url ) {
			if ( $url === '' ) continue;
			$id = attachment_url_to_postid( $url );
			if ( $id > 0 ) return $id;
			// Retry with the WP resize suffix stripped (-300x200 before extension).
			$stripped = preg_replace( '/-\d{1,5}x\d{1,5}(?=\.[a-z0-9]+$)/i', '', $url );
			if ( is_string( $stripped ) && $stripped !== $url ) {
				$id = attachment_url_to_postid( $stripped );
				if ( $id > 0 ) return $id;
			}
		}
		return 0;
	}

	/**
	 * Update alt="" on <img> tags whose src matches one of the candidate URLs,
	 * across published posts that contain that src. Conservative: only touches
	 * the exact <img> whose src matches; never edits unrelated markup.
	 *
	 * @param array<int,string> $candidates
	 */
	private static function rewrite_inline_alt( array $candidates, string $alt ): int {
		global $wpdb;
		$count = 0;

		// Build the set of bare filenames to LIKE-search post content cheaply.
		$needles = [];
		foreach ( $candidates as $url ) {
			$file = wp_basename( strtok( $url, '?' ) );
			if ( $file !== '' ) $needles[ $file ] = $url;
		}
		if ( empty( $needles ) ) return 0;

		foreach ( $needles as $file => $url ) {
			$like  = '%' . $wpdb->esc_like( $file ) . '%';
			$posts = $wpdb->get_results( $wpdb->prepare(
				"SELECT ID, post_content FROM {$wpdb->posts}
				 WHERE post_status = 'publish' AND post_content LIKE %s LIMIT 50",
				$like
			) );
			foreach ( (array) $posts as $post ) {
				$updated = self::set_alt_on_imgs( (string) $post->post_content, $file, $alt );
				if ( $updated !== $post->post_content ) {
					wp_update_post( [ 'ID' => $post->ID, 'post_content' => $updated ] );
					$count++;
				}
			}
		}
		return $count;
	}

	/** Set alt on every <img> whose src contains $file. PHP-7.4 safe. */
	private static function set_alt_on_imgs( string $html, string $file, string $alt ): string {
		$file_q = preg_quote( $file, '#' );
		$alt_esc = esc_attr( $alt );

		return (string) preg_replace_callback(
			'#<img\b[^>]*?>#i',
			static function ( array $m ) use ( $file_q, $alt_esc ): string {
				$tag = $m[0];
				if ( ! preg_match( '#src=(["\'])[^"\']*' . $file_q . '[^"\']*\1#i', $tag ) ) {
					return $tag; // not our image
				}
				if ( preg_match( '#\salt=(["\']).*?\1#i', $tag ) ) {
					return (string) preg_replace( '#\salt=(["\']).*?\1#i', ' alt="' . $alt_esc . '"', $tag );
				}
				// No alt attribute yet — inject one before the closing bracket.
				return (string) preg_replace( '#\s*/?>$#', ' alt="' . $alt_esc . '" />', $tag );
			},
			$html
		);
	}
}
