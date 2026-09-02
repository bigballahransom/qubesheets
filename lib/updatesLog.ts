/**
 * Product Updates Log — powers the in-app /updates changelog page and the
 * "What's New" unread dot in the sidebar.
 *
 * ========================================
 * HOW TO ADD AN UPDATE:
 * ========================================
 *
 * 1. Add an entry to the top of the current month's group in `updates`
 *    (create a new month group at the top of the array if needed).
 * 2. Bump LATEST_UPDATES_VERSION to today's date (YYYY-MM-DD). This is what
 *    makes the unread dot reappear in the sidebar for every user.
 * 3. Write for movers, not developers: describe what changed for the person
 *    running surveys/crews, never internal tech (AI models, queues, vendors,
 *    service names) or embarrassing bug details.
 *
 * The unread dot works per-device via localStorage (UPDATES_SEEN_STORAGE_KEY
 * holds the last version the user viewed; the sidebar marks it seen when they
 * visit /updates).
 */
import {
  Zap,
  Package,
  Video,
  Camera,
  Link2,
  FileText,
  Mail,
  Scale,
  LayoutGrid,
  Users,
  ClipboardList,
  ShieldCheck,
} from 'lucide-react';

/** Bump to today's date (YYYY-MM-DD) whenever a new entry is added. */
export const LATEST_UPDATES_VERSION = '2026-09-02';

/** localStorage key holding the last LATEST_UPDATES_VERSION the user viewed. */
export const UPDATES_SEEN_STORAGE_KEY = 'qs-updates-last-seen';

export type UpdateTag = 'New' | 'Improved' | 'Fixed';

export interface UpdateEntry {
  tag: UpdateTag;
  icon: React.ElementType;
  title: string;
  description: string;
}

export interface MonthGroup {
  month: string;
  entries: UpdateEntry[];
}

export const updates: MonthGroup[] = [
  {
    month: 'September 2026',
    entries: [
      {
        tag: 'New',
        icon: LayoutGrid,
        title: 'A real dashboard for your whole operation',
        description:
          'The Dashboard now opens on My Stuff — your scheduled calls plus recent activity on your projects — with new tabs for company-wide numbers: an Overview with surveys, calls, and cubic feet captured; a Survey Pipeline that shows where projects stall between "link sent" and "signed off"; and an Activity tab breaking down virtual calls, self-serve surveys, on-site uploads, and photos by rep. If you use embedded lead forms, a Leads tab tracks views, submissions, and where visitors drop off. Everything filters by date range and rep.',
      },
    ],
  },
  {
    month: 'August 2026',
    entries: [
      {
        tag: 'Fixed',
        icon: Video,
        title: 'Video calls find your customer automatically',
        description:
          'No more "both waiting for each other": if your customer opens an older call link, they are now moved into your current waiting room automatically, and you\'ll see a one-tap button if they\'re waiting somewhere else. Dropped connections now rejoin the same call in place instead of kicking anyone out, and abandoned connection attempts no longer leave junk recordings on the project.',
      },
      {
        tag: 'New',
        icon: Scale,
        title: 'Edit weights right on the inventory sheet',
        description:
          'You can now adjust an item’s weight directly in the inventory sheet without touching its cubic feet. Perfect for heavy items like safes, pianos, and gym equipment where the standard estimate doesn’t tell the whole story.',
      },
      {
        tag: 'Improved',
        icon: LayoutGrid,
        title: 'Smarter room-by-room inventory',
        description:
          'Walkthrough videos are now broken down by the areas of the home as the customer moves through them. The result: fewer duplicate items, cleaner room labels, and more accurate cube and weight totals on every survey.',
      },
      {
        tag: 'Improved',
        icon: Video,
        title: 'Faster, more reliable video processing',
        description:
          'Major upgrades under the hood mean walkthrough videos turn into inventories quicker and more consistently — even during busy times of day.',
      },
      {
        tag: 'Improved',
        icon: Zap,
        title: 'Instant playback for recorded walkthroughs',
        description:
          'Recorded video walkthroughs are now ready to watch right away — no more waiting for the video to finish preparing before you can review it.',
      },
      {
        tag: 'New',
        icon: Camera,
        title: 'Photo capture option for Media Vault',
        description:
          'Crews using the Media Vault can now snap individual photos in addition to video — handy for documenting existing damage, building conditions, or parking situations.',
      },
      {
        tag: 'Improved',
        icon: Link2,
        title: 'SmartMoving sync improvements',
        description:
          'Syncing to SmartMoving is smoother, and inventories can now start processing while a video call is still in progress — so your survey results are ready sooner after you hang up.',
      },
      {
        tag: 'Improved',
        icon: Camera,
        title: 'Better customer self-survey experience',
        description:
          'Customers recording their own walkthrough now get clearer camera permission prompts and a 3-2-1 countdown before recording starts. Fewer confused customers, fewer failed recordings.',
      },
      {
        tag: 'New',
        icon: Mail,
        title: 'Email notifications',
        description:
          'Get an email when important things happen on your projects — like a customer finishing their self-survey — so nothing slips through the cracks.',
      },
      {
        tag: 'New',
        icon: ClipboardList,
        title: 'Duplicate a project',
        description:
          'Copy an existing project — inventory and all — in one click. Great for repeat customers, revised quotes, or splitting a job into multiple moves.',
      },
      {
        tag: 'Improved',
        icon: Video,
        title: 'Bigger video uploads',
        description:
          'The upload limit for walkthrough videos has been raised to 1GB, so longer or higher-quality videos from customers go through without a hitch.',
      },
      {
        tag: 'New',
        icon: ClipboardList,
        title: 'Archive projects',
        description:
          'Tuck completed or dead jobs out of the way without deleting them. Your project list stays clean, and the history stays available if you need it.',
      },
      {
        tag: 'Improved',
        icon: Link2,
        title: 'More control over lead forms',
        description:
          'New customization options for the lead capture forms on your website, plus finer control over how leads and opportunities land in SmartMoving.',
      },
    ],
  },
  {
    month: 'July 2026',
    entries: [
      {
        tag: 'New',
        icon: Package,
        title: 'Media Vault',
        description:
          'A dedicated home for reference photos and videos that aren’t part of the inventory — building access, elevator reservations, parking, existing damage. Capture it, keep it with the job, and share it with the crew.',
      },
      {
        tag: 'New',
        icon: Link2,
        title: 'SmartMoving lead webhook + MoveRight support',
        description:
          'New leads can flow straight in from SmartMoving automatically, and MoveRight joins the list of supported systems.',
      },
      {
        tag: 'Improved',
        icon: Camera,
        title: 'Much better photo & video viewing on mobile',
        description:
          'Swipe between photos and videos on your phone, with a cleaner full-screen viewer. Reviewing a survey from the truck cab actually feels good now.',
      },
      {
        tag: 'Improved',
        icon: Video,
        title: 'Longer uploaded walkthroughs',
        description:
          'Uploaded inventory videos of up to 20 minutes are now fully supported — enough for a large home, garage, and shed in a single take.',
      },
      {
        tag: 'New',
        icon: Link2,
        title: 'Moverbase integration',
        description:
          'Push your surveys into Moverbase. If you run your business on Moverbase, your Qube Sheets inventories now land right where your quotes live.',
      },
      {
        tag: 'Improved',
        icon: Link2,
        title: 'Supermove: re-sync as many times as you need',
        description:
          'You can now sync a project to Supermove multiple times — the latest sync wins. Update the inventory after a customer call and push it again without any workarounds.',
      },
      {
        tag: 'New',
        icon: Package,
        title: 'Editable Boxes tab',
        description:
          'Box counts are now fully editable, and box totals match everywhere they appear in the app — the sheet, the PDF, and customer-facing links all agree.',
      },
      {
        tag: 'Improved',
        icon: ClipboardList,
        title: 'Edit item names and special handling',
        description:
          'Rename items and adjust special handling flags right from the editing view, with a sidebar that stays put while you scroll through a long inventory.',
      },
      {
        tag: 'Improved',
        icon: Scale,
        title: 'Total weight on crew and customer links',
        description:
          'Shared crew and customer links now show the total estimated weight of the move, not just item counts and cube.',
      },
      {
        tag: 'Fixed',
        icon: ShieldCheck,
        title: 'Reliability improvements',
        description:
          'A problem with one photo or video can no longer take down a whole page — the app now contains the issue and keeps the rest of your work usable, and our team gets notified automatically.',
      },
    ],
  },
  {
    month: 'June 2026',
    entries: [
      {
        tag: 'New',
        icon: Link2,
        title: 'Chariot integration',
        description:
          'Connect Qube Sheets to Chariot and send your survey results straight into your Chariot workflow.',
      },
      {
        tag: 'Improved',
        icon: FileText,
        title: 'Better PDFs and share links',
        description:
          'Inventory PDFs and shareable links got a round of polish — cleaner layout and more consistent item details, so what you hand a customer looks sharp.',
      },
      {
        tag: 'New',
        icon: Users,
        title: 'Customer review link settings',
        description:
          'Control what customers see when you send them a link to review their inventory — show or hide the details that matter for your sales process.',
      },
    ],
  },
  {
    month: 'May 2026',
    entries: [
      {
        tag: 'New',
        icon: Users,
        title: 'Waiting room for video calls',
        description:
          'Customers joining a video survey now land in a friendly waiting room until your rep joins — no more awkward empty screens or missed connections.',
      },
      {
        tag: 'Improved',
        icon: Video,
        title: 'Better mobile layout on video calls',
        description:
          'On the customer’s phone, their own camera view is now front and center with your rep in a small picture-in-picture — which means better footage of the home, since that’s the camera doing the surveying.',
      },
    ],
  },
];
