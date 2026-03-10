/**
 * Feature Announcements Configuration
 *
 * This file defines the current app version and all feature announcements.
 * Each user only sees an announcement ONCE per version.
 *
 * ========================================
 * HOW TO ADD A NEW ANNOUNCEMENT:
 * ========================================
 *
 * 1. Add a new entry to FEATURE_ANNOUNCEMENTS with a new version key (e.g., 'v1.1')
 * 2. Update CURRENT_APP_VERSION to match the new version
 * 3. Deploy - users will see the popup on their next login
 *
 * TEMPLATE - Copy this for new announcements:
 * ----------------------------------------
 * 'v1.1': {
 *   title: "What's New?",
 *   subtitle: 'Optional subtitle here',  // optional
 *   sections: [
 *     {
 *       sectionTitle: 'Section Name',
 *       sectionIcon: 'Video',  // Lucide icon name
 *       features: [
 *         {
 *           icon: 'Sparkles',  // Lucide icon name
 *           title: 'Feature Title',
 *           description: 'Feature description here',
 *         },
 *       ],
 *     },
 *   ],
 * },
 * ----------------------------------------
 *
 * AVAILABLE ICONS (from Lucide):
 * Sparkles, Package, FileText, CheckCircle, Zap, Video, Camera,
 * MessageSquare, Bell, Settings, Users
 * (Add more to iconMap in NewFeaturesModal.tsx if needed)
 */

export interface Feature {
  icon: string; // Lucide icon name
  title: string;
  description: string;
}

export interface FeatureSection {
  sectionTitle: string;
  sectionIcon: string;
  features: Feature[];
}

export interface FeatureAnnouncement {
  title: string;
  subtitle?: string;
  sections: FeatureSection[];
}

// Current version - update this to trigger new announcements
export const CURRENT_APP_VERSION = 'v1.0';

// All feature announcements by version
export const FEATURE_ANNOUNCEMENTS: Record<string, FeatureAnnouncement> = {
  'v1.0': {
    title: "What's New?",
    sections: [
      {
        sectionTitle: 'Video Call',
        sectionIcon: 'Video',
        features: [
          {
            icon: 'Sparkles',
            title: 'Virtual Backgrounds',
            description: 'Blur or replace your background during calls for a professional look',
          },
          {
            icon: 'Package',
            title: 'Auto Inventory',
            description: 'Complete inventory from entire call generated moments after your video call ends',
          },
          {
            icon: 'FileText',
            title: 'Call Notes',
            description: 'Automatic notes taken from the conversation',
          },
          {
            icon: 'CheckCircle',
            title: 'Smart Item Tracking',
            description: 'Items discussed as "not going" are automatically marked',
          },
          {
            icon: 'Zap',
            title: 'Click to Find',
            description: 'Click items on the spreadsheet to locate them in video calls',
          },
        ],
      },
      {
        sectionTitle: 'Shareable Links',
        sectionIcon: 'Users',
        features: [
          {
            icon: 'Users',
            title: 'Crew Review Link',
            description: 'Send a link to your crew to review the job',
          },
          {
            icon: 'CheckCircle',
            title: 'Customer Review Link',
            description: 'Let customers verify their inventory and confirm everything is accurate. Have them sign off before the job',
          },
        ],
      },
    ],
  },
};

// Public routes where the popup should NOT appear
export const PUBLIC_ROUTES = [
  '/video-call',
  '/customer-upload',
  '/inventory-review',
  '/crew-review',
  '/sign-in',
  '/sign-up',
  '/form',
  '/call-complete',
  '/organization-selection',
];

/**
 * Check if a pathname is a public route (no popup)
 */
export function isPublicRoute(pathname: string): boolean {
  return PUBLIC_ROUTES.some((route) => pathname.startsWith(route));
}

/**
 * Get the announcement for a specific version
 */
export function getAnnouncement(version: string): FeatureAnnouncement | null {
  return FEATURE_ANNOUNCEMENTS[version] || null;
}

/**
 * Get the current announcement
 */
export function getCurrentAnnouncement(): FeatureAnnouncement | null {
  return getAnnouncement(CURRENT_APP_VERSION);
}
