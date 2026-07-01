<?php
/**
 * Poirier CMS — redirect bridge (Redirection plugin).
 *
 * A single API-key-gated, READ-ONLY endpoint the CMS calls to mirror the site's
 * redirects out of the "Redirection" plugin (by John Godley). Phase 1 is read
 * only — the CMS nightly-syncs this into Postgres and shows a list; creating /
 * editing / deleting redirects is a LATER phase.
 *
 *   GET /wp-json/poirier-cms/v1/redirects
 *     → { success, redirectionActive, pluginVersion, redirects[], groups[], count }
 *
 * We read the RAW rows straight from Redirection's own tables
 * (`{prefix}redirection_items` / `{prefix}redirection_groups`) rather than going
 * through Redirection's REST API: its REST is capability-gated (cookie/nonce or
 * Application Passwords), which is awkward server-to-server, whereas this endpoint
 * reuses our existing X-Poirier-API-Key auth and returns the fields verbatim so
 * the CMS owns all normalization. `Red_Item` is only used as an "is Redirection
 * active?" signal; the read itself is table-based so it stays version-robust.
 *
 * Honest reporting (mirrors class-poirier-cache.php): when the Redirection plugin
 * isn't installed/active the endpoint returns 200 with
 * `{ success:false, skipped:true, reason:'…', redirectionActive:false }` rather
 * than erroring — "not applicable" is a skip, not a failure.
 */

declare(strict_types=1);

if ( ! defined( 'ABSPATH' ) ) exit;

class Poirier_Redirect {

	private const NAMESPACE = 'poirier-cms/v1';

	public static function register_routes(): void {
		register_rest_route( self::NAMESPACE, '/redirects', [
			[
				'methods'             => 'GET',
				'callback'            => [ self::class, 'handle_list' ],
				'permission_callback' => [ 'Poirier_API', 'authenticate' ],
			],
			[
				// Phase 2 — create. Body: source, target, actionCode, actionType,
				// matchType, regex, groupId, enabled, title (all CMS-gated upstream).
				'methods'             => 'POST',
				'callback'            => [ self::class, 'handle_create' ],
				'permission_callback' => [ 'Poirier_API', 'authenticate' ],
			],
		] );

		register_rest_route( self::NAMESPACE, '/redirects/(?P<id>\d+)', [
			[
				// Update (also handles enable/disable via the `enabled` field).
				'methods'             => 'POST',
				'callback'            => [ self::class, 'handle_update' ],
				'permission_callback' => [ 'Poirier_API', 'authenticate' ],
			],
			[
				'methods'             => 'DELETE',
				'callback'            => [ self::class, 'handle_delete' ],
				'permission_callback' => [ 'Poirier_API', 'authenticate' ],
			],
		] );
	}

	/**
	 * Mirror every redirect + group out of the Redirection plugin as raw rows.
	 * Returns a skipped payload (200) when Redirection isn't present so the CMS
	 * records "not active" honestly instead of treating the site as unreachable.
	 */
	public static function handle_list( WP_REST_Request $request ): WP_REST_Response {
		if ( ! self::redirection_active() ) {
			return new WP_REST_Response( [
				'success'          => false,
				'skipped'          => true,
				'reason'           => 'Redirection plugin not active on this site.',
				'redirectionActive' => false,
				'pluginVersion'    => null,
				'redirects'        => [],
				'groups'           => [],
				'count'            => 0,
			], 200 );
		}

		$redirects = self::read_items();

		return new WP_REST_Response( [
			'success'          => true,
			'redirectionActive' => true,
			'pluginVersion'    => self::plugin_version(),
			'redirects'        => $redirects,
			'groups'           => self::read_groups(),
			'count'            => count( $redirects ),
		], 200 );
	}

	// ── Writes (Phase 2) — gated by X-Poirier-API-Key upstream ────────────────

	/** Skipped response (200) when Redirection isn't installed — a skip, not a failure. */
	private static function skipped_response(): WP_REST_Response {
		return new WP_REST_Response( [
			'success'           => false,
			'skipped'           => true,
			'reason'            => 'Redirection plugin not active on this site.',
			'redirectionActive' => false,
			'redirect'          => null,
		], 200 );
	}

	/** Create a redirect. Prefers Red_Item::create(), falls back to $wpdb. */
	public static function handle_create( WP_REST_Request $request ): WP_REST_Response|WP_Error {
		if ( ! self::redirection_active() ) {
			return self::skipped_response();
		}
		$b = self::write_body( $request );
		if ( $b['source'] === '' ) {
			return new WP_Error( 'bad_request', 'A redirect source is required.', [ 'status' => 400 ] );
		}

		$id = 0;
		if ( class_exists( 'Red_Item' ) && method_exists( 'Red_Item', 'create' ) ) {
			$created = Red_Item::create( self::red_item_details( $b ) );
			if ( is_wp_error( $created ) ) {
				return new WP_Error( 'create_failed', $created->get_error_message(), [ 'status' => 500 ] );
			}
			$id = method_exists( $created, 'get_id' ) ? (int) $created->get_id() : 0;
		} else {
			$id = self::wpdb_insert( $b );
			if ( $id <= 0 ) {
				return new WP_Error( 'create_failed', 'Could not create the redirect.', [ 'status' => 500 ] );
			}
		}

		return self::write_result( $id );
	}

	/** Update a redirect (and enable/disable when the `enabled` field is present). */
	public static function handle_update( WP_REST_Request $request ): WP_REST_Response|WP_Error {
		if ( ! self::redirection_active() ) {
			return self::skipped_response();
		}
		$id = (int) $request->get_param( 'id' );
		$b  = self::write_body( $request );

		if ( class_exists( 'Red_Item' ) && method_exists( 'Red_Item', 'get_by_id' ) ) {
			$item = Red_Item::get_by_id( $id );
			if ( ! $item ) {
				return new WP_Error( 'not_found', "Redirect {$id} not found.", [ 'status' => 404 ] );
			}
			// Enable/disable first (dedicated toggle), then any field update.
			if ( $b['has_enabled'] ) {
				if ( $b['enabled'] && method_exists( $item, 'enable' ) ) {
					$item->enable();
				} elseif ( ! $b['enabled'] && method_exists( $item, 'disable' ) ) {
					$item->disable();
				}
			}
			if ( $b['has_fields'] && method_exists( $item, 'update' ) ) {
				$res = $item->update( self::red_item_details( $b ) );
				if ( is_wp_error( $res ) ) {
					return new WP_Error( 'update_failed', $res->get_error_message(), [ 'status' => 500 ] );
				}
			}
		} else {
			if ( ! self::wpdb_update( $id, $b ) ) {
				return new WP_Error( 'not_found', "Redirect {$id} not found.", [ 'status' => 404 ] );
			}
		}

		return self::write_result( $id );
	}

	/** Delete a redirect. */
	public static function handle_delete( WP_REST_Request $request ): WP_REST_Response|WP_Error {
		if ( ! self::redirection_active() ) {
			return self::skipped_response();
		}
		$id = (int) $request->get_param( 'id' );

		if ( class_exists( 'Red_Item' ) && method_exists( 'Red_Item', 'get_by_id' ) ) {
			$item = Red_Item::get_by_id( $id );
			if ( $item && method_exists( $item, 'delete' ) ) {
				$item->delete();
			}
		} else {
			global $wpdb;
			$table = self::items_table();
			// phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
			$wpdb->delete( $table, [ 'id' => $id ], [ '%d' ] );
		}

		return new WP_REST_Response( [
			'success'           => true,
			'redirectionActive' => true,
			'deleted'           => true,
			'redirect'          => null,
		], 200 );
	}

	/** Re-read the resulting row and return it (proof of what landed). */
	private static function write_result( int $id ): WP_REST_Response {
		return new WP_REST_Response( [
			'success'           => true,
			'redirectionActive' => true,
			'redirect'          => self::read_item_by_id( $id ),
		], 200 );
	}

	/** Normalize the CMS write body into a stable internal shape. */
	private static function write_body( WP_REST_Request $request ): array {
		$body = $request->get_json_params() ?? [];
		$has_enabled = array_key_exists( 'enabled', $body );
		// "fields" = any editable field other than the enable/disable toggle.
		$field_keys = [ 'source', 'target', 'actionCode', 'actionType', 'matchType', 'regex', 'groupId', 'title' ];
		$has_fields = false;
		foreach ( $field_keys as $k ) {
			if ( array_key_exists( $k, $body ) ) { $has_fields = true; break; }
		}
		return [
			'source'      => isset( $body['source'] ) ? esc_url_raw( (string) $body['source'] ) : '',
			'target'      => array_key_exists( 'target', $body ) && $body['target'] !== null ? esc_url_raw( (string) $body['target'] ) : null,
			'action_code' => isset( $body['actionCode'] ) ? (int) $body['actionCode'] : 301,
			'action_type' => isset( $body['actionType'] ) ? sanitize_text_field( (string) $body['actionType'] ) : ( ! empty( $body['target'] ) ? 'url' : 'error' ),
			'match_type'  => isset( $body['matchType'] ) ? sanitize_text_field( (string) $body['matchType'] ) : 'url',
			'regex'       => ! empty( $body['regex'] ),
			'group_id'    => isset( $body['groupId'] ) && $body['groupId'] !== null ? (int) $body['groupId'] : self::default_group_id(),
			'title'       => isset( $body['title'] ) ? sanitize_text_field( (string) $body['title'] ) : null,
			'enabled'     => $has_enabled ? ! empty( $body['enabled'] ) : true,
			'has_enabled' => $has_enabled,
			'has_fields'  => $has_fields,
		];
	}

	/** Build the Red_Item::create()/update() details array from our body shape. */
	private static function red_item_details( array $b ): array {
		return [
			'url'         => $b['source'],
			'match_type'  => $b['match_type'],
			'action_type' => $b['action_type'],
			'action_code' => $b['action_code'],
			'group_id'    => $b['group_id'],
			'title'       => $b['title'] ?? '',
			'regex'       => $b['regex'],
			'action_data' => $b['action_type'] === 'url' ? [ 'url' => (string) $b['target'] ] : [],
		];
	}

	/** Direct-table insert fallback. Returns the new id (0 on failure). */
	private static function wpdb_insert( array $b ): int {
		global $wpdb;
		$table = self::items_table();
		// phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
		$ok = $wpdb->insert( $table, [
			'url'         => $b['source'],
			'match_url'   => $b['source'],
			'match_data'  => wp_json_encode( [ 'source' => [ 'flag_regex' => $b['regex'] ] ] ),
			'regex'       => $b['regex'] ? 1 : 0,
			'position'    => 0,
			'last_count'  => 0,
			'group_id'    => $b['group_id'],
			'status'      => $b['enabled'] ? 'enabled' : 'disabled',
			'action_type' => $b['action_type'],
			'action_code' => $b['action_code'],
			'action_data' => $b['action_type'] === 'url' ? (string) $b['target'] : '',
			'match_type'  => $b['match_type'],
			'title'       => $b['title'] ?? '',
		] );
		return $ok ? (int) $wpdb->insert_id : 0;
	}

	/** Direct-table update fallback. Returns false when the row doesn't exist. */
	private static function wpdb_update( int $id, array $b ): bool {
		global $wpdb;
		$table = self::items_table();
		if ( ! self::read_item_by_id( $id ) ) {
			return false;
		}
		$data = [ 'status' => $b['enabled'] ? 'enabled' : 'disabled' ];
		if ( $b['has_fields'] ) {
			$data['url']         = $b['source'];
			$data['match_url']   = $b['source'];
			$data['regex']       = $b['regex'] ? 1 : 0;
			$data['group_id']    = $b['group_id'];
			$data['action_type'] = $b['action_type'];
			$data['action_code'] = $b['action_code'];
			$data['action_data'] = $b['action_type'] === 'url' ? (string) $b['target'] : '';
			$data['match_type']  = $b['match_type'];
			$data['title']       = $b['title'] ?? '';
		}
		// phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
		$wpdb->update( $table, $data, [ 'id' => $id ] );
		return true;
	}

	/** Smallest existing group id, or 1 — a valid default for new redirects. */
	private static function default_group_id(): int {
		global $wpdb;
		$table = self::groups_table();
		if ( ! self::table_exists( $table ) ) {
			return 1;
		}
		// phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
		$id = (int) $wpdb->get_var( "SELECT id FROM {$table} ORDER BY id ASC LIMIT 1" );
		return $id > 0 ? $id : 1;
	}

	/** Read a single shaped item row by its plugin id (null when absent). */
	private static function read_item_by_id( int $id ): ?array {
		global $wpdb;
		$table = self::items_table();
		if ( ! self::table_exists( $table ) ) {
			return null;
		}
		// phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
		$row = $wpdb->get_row( $wpdb->prepare( "SELECT * FROM {$table} WHERE id = %d", $id ), ARRAY_A );
		return is_array( $row ) ? self::shape_item( $row ) : null;
	}

	// ── Redirection detection ─────────────────────────────────────────────────

	/** Redirection is "active" if its classes are loaded OR its items table exists. */
	private static function redirection_active(): bool {
		if ( class_exists( 'Red_Item' ) || defined( 'REDIRECTION_VERSION' ) ) {
			return true;
		}
		return self::table_exists( self::items_table() );
	}

	private static function plugin_version(): ?string {
		if ( defined( 'REDIRECTION_VERSION' ) ) {
			return (string) REDIRECTION_VERSION;
		}
		return null;
	}

	// ── Raw reads (verbatim columns — the CMS normalizes) ─────────────────────

	/**
	 * Raw redirect rows from `{prefix}redirection_items`. Columns match the
	 * plugin's schema: id, url (source), regex, position, last_count, last_access,
	 * group_id, status (enabled|disabled), action_type, action_code, action_data
	 * (target for url redirects), match_type, match_data, title.
	 */
	private static function read_items(): array {
		global $wpdb;
		$table = self::items_table();
		if ( ! self::table_exists( $table ) ) {
			return [];
		}
		// phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared -- table name is internal, no user input.
		$rows = $wpdb->get_results( "SELECT * FROM {$table} ORDER BY position ASC, id ASC", ARRAY_A );
		if ( ! is_array( $rows ) ) {
			return [];
		}
		return array_map( [ self::class, 'shape_item' ], $rows );
	}

	/** Raw group rows from `{prefix}redirection_groups`. */
	private static function read_groups(): array {
		global $wpdb;
		$table = self::groups_table();
		if ( ! self::table_exists( $table ) ) {
			return [];
		}
		// phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared -- table name is internal, no user input.
		$rows = $wpdb->get_results( "SELECT * FROM {$table} ORDER BY position ASC, id ASC", ARRAY_A );
		if ( ! is_array( $rows ) ) {
			return [];
		}
		return array_map( static function ( array $g ): array {
			return [
				'id'        => isset( $g['id'] ) ? (int) $g['id'] : null,
				'name'      => isset( $g['name'] ) ? (string) $g['name'] : '',
				'module_id' => isset( $g['module_id'] ) ? (int) $g['module_id'] : null,
				'status'    => isset( $g['status'] ) ? (string) $g['status'] : null,
				'position'  => isset( $g['position'] ) ? (int) $g['position'] : 0,
			];
		}, $rows );
	}

	/** Coerce a raw items row into stable typed JSON (numbers as numbers). */
	private static function shape_item( array $r ): array {
		return [
			'id'          => isset( $r['id'] ) ? (int) $r['id'] : null,
			'url'         => isset( $r['url'] ) ? (string) $r['url'] : '',
			'match_type'  => isset( $r['match_type'] ) ? (string) $r['match_type'] : null,
			'action_type' => isset( $r['action_type'] ) ? (string) $r['action_type'] : null,
			'action_code' => isset( $r['action_code'] ) ? (int) $r['action_code'] : null,
			'action_data' => array_key_exists( 'action_data', $r ) ? $r['action_data'] : null,
			'match_data'  => array_key_exists( 'match_data', $r ) ? $r['match_data'] : null,
			'regex'       => isset( $r['regex'] ) ? (int) $r['regex'] : 0,
			'group_id'    => isset( $r['group_id'] ) ? (int) $r['group_id'] : null,
			'position'    => isset( $r['position'] ) ? (int) $r['position'] : 0,
			'status'      => isset( $r['status'] ) ? (string) $r['status'] : 'enabled',
			'last_access' => isset( $r['last_access'] ) ? (string) $r['last_access'] : null,
			'last_count'  => isset( $r['last_count'] ) ? (int) $r['last_count'] : 0,
			'title'       => isset( $r['title'] ) ? (string) $r['title'] : null,
		];
	}

	// ── Helpers ───────────────────────────────────────────────────────────────

	private static function items_table(): string {
		global $wpdb;
		return $wpdb->prefix . 'redirection_items';
	}

	private static function groups_table(): string {
		global $wpdb;
		return $wpdb->prefix . 'redirection_groups';
	}

	private static function table_exists( string $table ): bool {
		global $wpdb;
		// phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
		$found = $wpdb->get_var( $wpdb->prepare( 'SHOW TABLES LIKE %s', $table ) );
		return $found === $table;
	}
}
