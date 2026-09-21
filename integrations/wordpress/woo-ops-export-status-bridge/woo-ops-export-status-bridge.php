<?php
/**
 * Plugin Name: Woo Ops Export Status Bridge
 * Description: Read-only REST exposure for the WooCommerce order-list Export Status marker.
 * Version: 1.8.0
 * Requires Plugins: woocommerce
 * Requires PHP: 7.4
 * Author: Woo Ops
 * License: GPL-2.0-or-later
 */

defined( 'ABSPATH' ) || exit;

const WOO_OPS_EXPORT_STATUS_META_KEY = '_wc_customer_order_csv_export_is_exported';
const WOO_OPS_EXPORT_STATUS_TAXONOMY = 'wc_export_is_order_exported';
const WOO_OPS_ALGOLPLUS_EXPORT_STATUS_META_KEY = 'woe_order_exported';

/**
 * Customer / Order / Coupon Export 5.0+ stores the global flag as a private
 * taxonomy term. Older releases used order metadata, so keep a read-only
 * fallback for stores that have not migrated yet.
 */
function woo_ops_order_export_status( WC_Order $order ): array {
	$order_id          = (int) $order->get_id();
	$order_meta_value  = $order->get_meta( WOO_OPS_EXPORT_STATUS_META_KEY, true );
	$post_meta_value   = get_post_meta( $order_id, WOO_OPS_EXPORT_STATUS_META_KEY, true );
	$post_meta_exists  = metadata_exists( 'post', $order_id, WOO_OPS_EXPORT_STATUS_META_KEY );
	$diagnostics       = array(
		'orderMetaPresent'   => method_exists( $order, 'meta_exists' )
			? (bool) $order->meta_exists( WOO_OPS_EXPORT_STATUS_META_KEY )
			: ( '' !== $order_meta_value && null !== $order_meta_value ),
		'postMetaPresent'    => $post_meta_exists,
		'orderMetaType'      => gettype( $order_meta_value ),
		'postMetaType'       => gettype( $post_meta_value ),
		'extensionAvailable' => false,
		'taxonomyAvailable'  => taxonomy_exists( WOO_OPS_EXPORT_STATUS_TAXONOMY ),
		'algolPlusAvailable' => defined( 'WOE_VERSION' ) || class_exists( 'WC_Order_Export_Admin' ),
		'algolPlusPostfixes' => 0,
	);
	$order_meta_exists = (bool) $diagnostics['orderMetaPresent'];

	// Advanced Order Export for WooCommerce (AlgolPlus) owns the order-list
	// column and sorter named `woe_export_status`. Its column implementation
	// checks `woe_order_exported` with every suffix supplied by this filter.
	// Mirror that loop exactly before considering compatibility sources from
	// other export extensions.
	if ( $diagnostics['algolPlusAvailable'] ) {
		$postfixes = apply_filters( 'woe_export_status_postfixes_to_verify', array( '' ) );
		$postfixes = is_array( $postfixes ) ? array_filter( $postfixes, 'is_scalar' ) : array( '' );
		$postfixes = array_values( array_unique( array_map( 'strval', $postfixes ) ) );
		$postfixes = empty( $postfixes ) ? array( '' ) : $postfixes;
		$diagnostics['algolPlusPostfixes'] = count( $postfixes );

		foreach ( $postfixes as $postfix ) {
			if ( $order->get_meta( WOO_OPS_ALGOLPLUS_EXPORT_STATUS_META_KEY . $postfix, true ) ) {
				return array(
					'status'      => 'exported',
					'source'      => 'algolplus_order_meta',
					'diagnostics' => $diagnostics,
				);
			}
		}

		return array(
			'status'      => 'not_exported',
			'source'      => 'algolplus_order_meta',
			'diagnostics' => $diagnostics,
		);
	}

	// Customer / Order / Coupon Export versions before 5.0 render the admin
	// column from post metadata. Reading both APIs is required on stores where
	// HPOS is enabled but the legacy extension still writes the compatibility
	// post table. Never return either raw value in diagnostics.
	if ( (bool) $post_meta_value ) {
		return array(
			'status'      => 'exported',
			'source'      => 'legacy_post_meta',
			'diagnostics' => $diagnostics,
		);
	}

	if ( (bool) $order_meta_value ) {
		return array(
			'status'      => 'exported',
			'source'      => 'legacy_order_meta',
			'diagnostics' => $diagnostics,
		);
	}

	$handler_class = '\\SkyVerge\\WooCommerce\\CSV_Export\\Taxonomies_Handler';
	$extension_status = null;
	if ( class_exists( $handler_class ) && is_callable( array( $handler_class, 'is_order_exported_globally' ) ) ) {
		$diagnostics['extensionAvailable'] = true;
		try {
			$method     = new ReflectionMethod( $handler_class, 'is_order_exported_globally' );
			$parameters = $method->getParameters();
			$parameter  = isset( $parameters[0] ) ? $parameters[0]->getType() : null;
			$argument   = $parameter instanceof ReflectionNamedType && ! $parameter->isBuiltin()
				? $order
				: $order_id;
			$extension_status = (bool) $handler_class::is_order_exported_globally( $argument );
		} catch ( Throwable $error ) {
			$extension_status = null;
		}
		if ( true === $extension_status ) {
			return array(
				'status'      => 'exported',
				'source'      => 'extension_api',
				'diagnostics' => $diagnostics,
			);
		}
	}

	if ( taxonomy_exists( WOO_OPS_EXPORT_STATUS_TAXONOMY ) ) {
		// The private term identifier is internal and has changed between
		// extension releases. Woo's own exported filter checks for any order
		// relationship in this taxonomy, so mirror that authoritative rule.
		$taxonomy_terms = wp_get_object_terms(
			$order_id,
			WOO_OPS_EXPORT_STATUS_TAXONOMY,
			array( 'fields' => 'ids' )
		);
		if ( is_wp_error( $taxonomy_terms ) ) {
			return array(
				'status'      => 'unknown',
				'source'      => 'unavailable',
				'diagnostics' => $diagnostics,
			);
		}

		return array(
			'status'      => empty( $taxonomy_terms ) ? 'not_exported' : 'exported',
			'source'      => 'taxonomy',
			'diagnostics' => $diagnostics,
		);
	}

	if ( false === $extension_status || $post_meta_exists || $order_meta_exists ) {
		return array(
			'status'      => 'not_exported',
			'source'      => $post_meta_exists ? 'legacy_post_meta' : ( $order_meta_exists ? 'legacy_order_meta' : 'extension_api' ),
			'diagnostics' => $diagnostics,
		);
	}

	return array(
		'status'      => 'unknown',
		'source'      => 'unavailable',
		'diagnostics' => $diagnostics,
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
			'id'          => (int) $order->get_id(),
			'key'         => 'algolplus_order_meta' === $export_status['source']
				? WOO_OPS_ALGOLPLUS_EXPORT_STATUS_META_KEY
				: WOO_OPS_EXPORT_STATUS_META_KEY,
			'status'      => $export_status['status'],
			'source'      => $export_status['source'],
			'diagnostics' => $export_status['diagnostics'],
		);
	}

	return rest_ensure_response(
		array(
			'version'       => 1,
			'bridgeVersion' => '1.8.0',
			'items'         => $items,
		)
	);
}
