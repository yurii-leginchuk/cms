<?php
declare(strict_types=1);

if ( ! defined( 'ABSPATH' ) ) exit;

class Poirier_Admin {

	public static function register_menu(): void {
		add_options_page(
			'Poirier CMS',
			'Poirier CMS',
			'manage_options',
			'poirier-cms',
			[ self::class, 'render_settings_page' ]
		);
	}

	public static function render_settings_page(): void {
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_die( 'Insufficient permissions.' );
		}

		// Handle key regeneration
		if ( isset( $_POST['poirier_regenerate_key'] ) && check_admin_referer( 'poirier_regenerate' ) ) {
			update_option( POIRIER_CMS_OPTION_KEY, Poirier_CMS::generate_key() );
			echo '<div class="notice notice-success is-dismissible"><p><strong>API key regenerated.</strong> Update it in your Poirier CMS site settings.</p></div>';
		}

		$api_key    = (string) get_option( POIRIER_CMS_OPTION_KEY, '' );
		$endpoint   = get_rest_url( null, 'poirier-cms/v1/update-meta' );
		$yoast_ok   = defined( 'WPSEO_VERSION' );
		$log        = (array) get_option( POIRIER_CMS_LOG_OPTION, [] );
		?>
		<div class="wrap">
			<h1 style="display:flex;align-items:center;gap:10px">
				<span>⚡</span> Poirier CMS Connector
			</h1>

			<?php if ( ! $yoast_ok ) : ?>
			<div class="notice notice-error">
				<p><strong>Yoast SEO is not active.</strong> This plugin requires Yoast SEO to update meta data.</p>
			</div>
			<?php endif; ?>

			<?php if ( empty( $api_key ) ) : ?>
			<div class="notice notice-warning">
				<p>No API key generated yet. <a href="?page=poirier-cms&generate=1">Generate one now.</a></p>
			</div>
			<?php endif; ?>

			<div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;max-width:960px;margin-top:20px">

				<!-- API Key card -->
				<div class="postbox">
					<div class="postbox-header"><h2 class="hndle">API Key</h2></div>
					<div class="inside">
						<p style="color:#646970">Copy this key into your <strong>Poirier CMS → Site Settings → WP API Key</strong> field.</p>
						<div style="display:flex;gap:8px;margin:12px 0">
							<input
								type="text"
								id="poirier-api-key"
								value="<?php echo esc_attr( $api_key ); ?>"
								readonly
								class="regular-text code"
								style="flex:1;font-family:monospace;font-size:13px"
							/>
							<button type="button" class="button button-primary" id="poirier-copy-btn">Copy</button>
						</div>
						<form method="post" style="margin-top:12px">
							<?php wp_nonce_field( 'poirier_regenerate' ); ?>
							<button
								type="submit"
								name="poirier_regenerate_key"
								class="button button-secondary"
								onclick="return confirm('Regenerate API key?\n\nThe current key will stop working immediately. You must update the key in Poirier CMS.');"
							>↻ Regenerate Key</button>
						</form>
					</div>
				</div>

				<!-- Status card -->
				<div class="postbox">
					<div class="postbox-header"><h2 class="hndle">Connection Info</h2></div>
					<div class="inside">
						<table class="widefat fixed striped" style="table-layout:auto">
							<tbody>
								<tr>
									<td><strong>REST Endpoint</strong></td>
									<td><code style="font-size:11px;word-break:break-all"><?php echo esc_html( $endpoint ); ?></code></td>
								</tr>
								<tr>
									<td><strong>Yoast SEO</strong></td>
									<td>
										<?php if ( $yoast_ok ) : ?>
											<span style="color:#00a32a">✔ Active</span>
											<span style="color:#646970"> v<?php echo esc_html( WPSEO_VERSION ); ?></span>
										<?php else : ?>
											<span style="color:#d63638">✘ Not active</span>
										<?php endif; ?>
									</td>
								</tr>
								<tr>
									<td><strong>Homepage type</strong></td>
									<td>
										<?php
										$front_page = get_option( 'show_on_front' );
										echo $front_page === 'page'
											? '<span style="color:#00a32a">✔ Static page</span> (ID ' . (int) get_option( 'page_on_front' ) . ')'
											: 'Posts page';
										?>
									</td>
								</tr>
								<tr>
									<td><strong>Plugin version</strong></td>
									<td><?php echo esc_html( POIRIER_CMS_VERSION ); ?></td>
								</tr>
							</tbody>
						</table>
					</div>
				</div>

			</div>

			<!-- Request log -->
			<div class="postbox" style="max-width:960px;margin-top:4px">
				<div class="postbox-header">
					<h2 class="hndle">Recent Requests <span style="font-size:12px;font-weight:400;color:#646970">(last <?php echo POIRIER_CMS_LOG_LIMIT; ?>)</span></h2>
				</div>
				<div class="inside" style="padding:0">
					<?php if ( empty( $log ) ) : ?>
						<p style="padding:16px;color:#646970">No requests received yet.</p>
					<?php else : ?>
					<table class="widefat fixed striped" style="border:0">
						<thead>
							<tr>
								<th style="width:160px">Time</th>
								<th>Page URL</th>
								<th style="width:100px">Result</th>
								<th style="width:80px">Post ID</th>
							</tr>
						</thead>
						<tbody>
							<?php foreach ( $log as $entry ) :
								$outcome = $entry['outcome'] ?? '';
								$color   = match( $outcome ) {
									'ok'          => '#00a32a',
									'not_found'   => '#dba617',
									'auth_failed' => '#d63638',
									default       => '#646970',
								};
								$label = match( $outcome ) {
									'ok'          => '✔ OK',
									'not_found'   => '⚠ Not found',
									'auth_failed' => '✘ Auth failed',
									default       => $outcome,
								};
							?>
							<tr>
								<td style="font-size:12px;color:#646970"><?php echo esc_html( $entry['time'] ?? '' ); ?></td>
								<td style="font-size:12px;word-break:break-all">
									<a href="<?php echo esc_url( $entry['url'] ?? '' ); ?>" target="_blank" rel="noopener">
										<?php echo esc_html( $entry['url'] ?? '' ); ?>
									</a>
								</td>
								<td style="font-size:12px;color:<?php echo $color; ?>;font-weight:600"><?php echo $label; ?></td>
								<td style="font-size:12px;color:#646970"><?php echo $entry['postId'] ? '#' . (int) $entry['postId'] : ( $entry['type'] === 'homepage' ? 'home' : '—' ); ?></td>
							</tr>
							<?php endforeach; ?>
						</tbody>
					</table>
					<div style="padding:10px 12px;text-align:right">
						<form method="post">
							<?php wp_nonce_field( 'poirier_clear_log' ); ?>
							<button type="submit" name="poirier_clear_log" class="button button-link-delete"
								onclick="return confirm('Clear request log?')">Clear log</button>
						</form>
					</div>
					<?php endif; ?>
				</div>
			</div>
		</div>

		<script>
		document.getElementById('poirier-copy-btn')?.addEventListener('click', function() {
			const val = document.getElementById('poirier-api-key').value;
			navigator.clipboard.writeText(val).then(() => {
				this.textContent = '✔ Copied';
				this.disabled = true;
				setTimeout(() => { this.textContent = 'Copy'; this.disabled = false; }, 2500);
			});
		});
		</script>
		<?php

		// Handle log clear
		if ( isset( $_POST['poirier_clear_log'] ) && check_admin_referer( 'poirier_clear_log' ) ) {
			delete_option( POIRIER_CMS_LOG_OPTION );
			echo '<script>location.reload();</script>';
		}
	}
}
