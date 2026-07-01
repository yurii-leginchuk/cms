<?php
/**
 * Plugin Name:  Poirier CMS Connector
 * Plugin URI:   https://poirier.agency
 * Description:  Receives meta, JSON-LD schema, image ALT, and CDN image-optimization updates from Poirier CMS and applies them via Yoast SEO / the media library. Also purges caches (WP Fastest Cache / WP Engine) and mirrors + manages redirects (Redirection plugin) on request.
 * Version:      1.10.0
 * Author:       Poirier Agency
 * License:      GPL-2.0-or-later
 * Requires PHP: 7.4
 * Requires at least: 6.0
 */

declare(strict_types=1);

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'POIRIER_CMS_VERSION',    '1.10.0' );
define( 'POIRIER_CMS_OPTION_KEY', 'poirier_cms_api_key' );
define( 'POIRIER_CMS_LOG_OPTION', 'poirier_cms_request_log' );
define( 'POIRIER_CMS_LOG_LIMIT',  50 );

require_once __DIR__ . '/includes/class-poirier-api.php';
require_once __DIR__ . '/includes/class-poirier-admin.php';
require_once __DIR__ . '/includes/class-poirier-schema.php';
require_once __DIR__ . '/includes/class-poirier-image.php';
require_once __DIR__ . '/includes/class-poirier-optimize.php';
require_once __DIR__ . '/includes/class-poirier-cache.php';
require_once __DIR__ . '/includes/class-poirier-redirect.php';

register_activation_hook( __FILE__, [ 'Poirier_CMS', 'activate' ] );
add_action( 'rest_api_init', [ 'Poirier_API',      'register_routes' ] );
add_action( 'rest_api_init', [ 'Poirier_Schema',   'register_routes' ] );
add_action( 'rest_api_init', [ 'Poirier_Image',    'register_routes' ] );
add_action( 'rest_api_init', [ 'Poirier_Optimize', 'register_routes' ] );
add_action( 'rest_api_init', [ 'Poirier_Cache',    'register_routes' ] );
add_action( 'rest_api_init', [ 'Poirier_Redirect', 'register_routes' ] );
add_action( 'admin_menu',    [ 'Poirier_Admin',    'register_menu'   ] );

Poirier_Schema::register_render_hooks();
Poirier_Optimize::register_render_hooks();

class Poirier_CMS {
	public static function activate(): void {
		if ( ! get_option( POIRIER_CMS_OPTION_KEY ) ) {
			update_option( POIRIER_CMS_OPTION_KEY, self::generate_key() );
		}
	}

	public static function generate_key(): string {
		return bin2hex( random_bytes( 24 ) ); // 48-char hex key
	}
}
