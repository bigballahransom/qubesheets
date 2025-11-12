/**
 * Client-side utility functions
 */

/**
 * Check if an organization has a specific add-on enabled
 * Returns false for organizations without metadata (legacy customers)
 * Returns true if the add-on is in the organization's metadata
 */
export function hasAddOn(organization: any, addOnId: string): boolean {
  const subscription = organization?.publicMetadata?.subscription;
  return subscription?.addOns?.includes(addOnId) || false;
}