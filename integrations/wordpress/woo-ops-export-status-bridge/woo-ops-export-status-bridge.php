<?php
/**
 * Plugin Name: Woo Ops Export Status Bridge
 * Description: Read-only REST exposure for WooCommerce Customer / Order / Coupon Export status.
 * Version: 1.3.0
 * Requires Plugins: woocommerce
 * Requires PHP: 7.4
 * Author: Woo Ops
 * License: GPL-2.0-or-later
 */

defined( 'ABSPATH' ) || exit;

const WOO_OPS_EXPORT_STATUS_META_KEY = '_wc_customer_order_csv_export_is_exported';
const WOO_OPS_EXPORT_STATUS_TAXONOMY = 'wc_export_is_order_exported';
const WOO_OPS_EXPORT_STATUS_GLOBAL_TERM = 'global';

/**
 * Customer / Order / Coupon Export 5.0+ stores the global flag as a private
 * taxonomy term. Older releases used order metadata, so keep a read-only
 * fallback for stores that have not migrated yet.
 */
function woo_ops_order_export_status( WC_Order $order ): array {
	$legacy_value    = $order->get_meta( WOO_OPS_EXPORT_STATUS_META_KEY, true );
	$legacy_exported = in_array( strtolower( trim( (string) $legacy_value ) ), array( '1', 'true', 'yes', 'exported' ), true );

	// Customer / Order / Coupon Export versions before 5.0 render the admin
	// column from this order meta value. Prefer a positive legacy value even
	// when a partially-migrated store also has the newer handler loaded.
	if ( $legacy_exported ) {
		return array(
			'exported' => true,
			'source'   => 'legacy_meta',
		);
	}

	$handler_class = '\\SkyVerge\\WooCommerce\\CSV_Export\\Taxonomies_Handler';
	if ( class_exists( $handler_class ) && is_callable( array( $handler_class, 'is_order_exported_globally' ) ) ) {
		return array(
			'exported' => (bool) $handler_class::is_order_exported_globally( (int) $order->get_id() ),
			'source'   => 'extension_api',
		);
	}

	if ( taxonomy_exists( WOO_OPS_EXPORT_STATUS_TAXONOMY ) ) {
		$taxonomy_status = is_object_in_term(
			(int) $order->get_id(),
			WOO_OPS_EXPORT_STATUS_TAXONOMY,
			WOO_OPS_EXPORT_STATUS_GLOBAL_TERM
		);

		return array(
			'exported' => true === $taxonomy_status,
			'source'   => 'taxonomy',
		);
	}

	return array(
		'exported' => false,
		'source'   => 'legacy_meta',
	);
}

/**
 * Keep the route inside Woo's authenticated namespace so existing read-only
 * consumer keys are validated by WooCommerce. This plugin registers no write route.
 */
add_action(
	'rest_api_init',
	static function (): void {
		register_rest_route(
			'wc/v3',
			'/woo-ops/export-status',
			array(
				'methods'             => WP_REST_Server::READABLE,
				'permission_callback' => static function (): bool {
					return current_user_can( 'manage_woocommerce' ) || current_user_can( 'edit_shop_orders' );
				},
				'callback'            => 'woo_ops_read_export_statuses',
				'args'                => array(
					'ids' => array(
						'required'          => true,
						'type'              => 'string',
						'validate_callback' => static function ( $value ): bool {
							return is_string( $value ) && 1 === preg_match( '/^\d+(?:,\d+){0,99}$/D', $value );
						},
					),
				),
			)
		);
	}
);

/**
 * @return WP_REST_Response|WP_Error
 */
function woo_ops_read_export_statuses( WP_REST_Request $request ) {
	$raw_ids = explode( ',', (string) $request->get_param( 'ids' ) );
	$ids     = array_values( array_unique( array_map( 'absint', $raw_ids ) ) );
	$ids     = array_slice( array_filter( $ids ), 0, 100 );

	if ( empty( $ids ) ) {
		return new WP_Error( 'woo_ops_invalid_order_ids', 'At least one valid order ID is required.', array( 'status' => 400 ) );
	}

	$items = array();
	foreach ( $ids as $order_id ) {
		$order = wc_get_order( $order_id );
		if ( ! $order ) {
			continue;
		}

		$export_status = woo_ops_order_export_status( $order );
		$items[]   = array(
			'id'     => (int) $order->get_id(),
			'key'    => WOO_OPS_EXPORT_STATUS_META_KEY,
			'status' => $export_status['exported'] ? 'exported' : 'not_exported',
			'source' => $export_status['source'],
		);
	}

	return rest_ensure_response(
		array(
			'version'       => 1,
			'bridgeVersion' => '1.3.0',
			'items'         => $items,
		)
	);
}
