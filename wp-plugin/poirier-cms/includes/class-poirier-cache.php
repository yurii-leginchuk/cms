<?php
/**
 * Poirier CMS — cache purge.
 *
 * A single API-key-gated endpoint the CMS calls to purge a caching layer that
 * lives on the WordPress host. Two targets:
 *
 *   target=wp        → WP Fastest Cache "clear all", plus a generic object-cache
 *                      flush as a fallback. This is the default.
 *   target=wpengine  → WP Engine's server-side cache purge (Varnish + memcached)
 *                      via the WpeCommon mu-plugin. Reports skipped honestly when
 *                      the host isn't WP Engine (WpeCommon absent).
 *
 * The CMS orchestrates ordering and per-layer reporting; this endpoint just does
 * one target per call and returns which methods actually ran.
 */

declare(strict_types=1);

if ( ! defined( 'ABSPATH' ) ) exit;

class Poirier_Cache {

	private const NAMESPACE = 'poirier-cms/v1';

	public static function register_routes(): void {
		register_rest_route( self::NAMESPACE, '/purge-cache', [
			'methods'             => 'POST',
			'callback'            => [ self::class, 'handle_purge' ],
			'permission_callback' => [ 'Poirier_API', 'authenticate' ],
		] );
	}

	public static function handle_purge( WP_REST_Request $request ): WP_REST_Response {
		$target = (string) $request->get_param( 'target' );
		if ( $target === 'wpengine' ) {
			return self::purge_wpengine();
		}
		return self::purge_wp();
	}

	/** WP Fastest Cache clear-all, with a generic object-cache flush fallback. */
	private static function purge_wp(): WP_REST_Response {
		$methods = [];

		// WP Fastest Cache exposes a global helper for a full purge.
		if ( function_exists( 'wpfc_clear_all_cache' ) ) {
			wpfc_clear_all_cache( true );
			$methods[] = 'wp-fastest-cache';
		} else {
			// Fallback hook — harmless if nothing is listening.
			do_action( 'wpfc_clear_all_cache' );
		}

		// Generic object cache (Redis/Memcached drop-ins, etc.).
		if ( function_exists( 'wp_cache_flush' ) ) {
			wp_cache_flush();
			$methods[] = 'object-cache';
		}

		return new WP_REST_Response( [
			'success' => true,
			'target'  => 'wp',
			'methods' => $methods,
		], 200 );
	}

	/** WP Engine server-side cache purge (Varnish + memcached) via WpeCommon. */
	private static function purge_wpengine(): WP_REST_Response {
		if ( ! class_exists( 'WpeCommon' ) ) {
			return new WP_REST_Response( [
				'success' => false,
				'target'  => 'wpengine',
				'skipped' => true,
				'reason'  => 'WP Engine not detected on this host (WpeCommon unavailable).',
			], 200 );
		}

		$methods = [];
		if ( method_exists( 'WpeCommon', 'purge_memcached' ) ) {
			WpeCommon::purge_memcached();
			$methods[] = 'wpe-memcached';
		}
		if ( method_exists( 'WpeCommon', 'purge_varnish_cache' ) ) {
			WpeCommon::purge_varnish_cache();
			$methods[] = 'wpe-varnish';
		}

		return new WP_REST_Response( [
			'success' => true,
			'target'  => 'wpengine',
			'methods' => $methods,
		], 200 );
	}
}
