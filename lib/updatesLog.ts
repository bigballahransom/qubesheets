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
  Bell,
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
export const LATEST_UPDATES_VERSION = '2026-09-10';

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
        tag: 'Improved',
        icon: Link2,
        title: 'New projects can take over a SmartMoving job link',
        description:
          'If a SmartMoving opportunity was already linked to an older Qube Sheets project (say, a repeat customer or a re-survey), syncing a new project to it no longer gets blocked. The new project simply takes over the link and the old project is unlinked automatically — you\'ll see a note in the sync window telling you which project it took over from. Only one project stays linked at a time, so your SmartMoving inventory always reflects the project you synced most recently.',
      },
      {
        tag: 'Improved',
        icon: Zap,
        title: 'SmartMoving sync is now verified 1-to-1',
        description:
          'Syncing to SmartMoving now mirrors your Qube Sheets inventory exactly, no matter the job size. Rooms that haven\'t changed are left untouched (much faster re-syncs), changed rooms are replaced cleanly, and after every sync we read SmartMoving back and confirm the item count, cubic feet, and weight match — you\'ll see "Verified — matches Qube Sheets exactly" right in the sync window, or a clear warning if anything is off. Large jobs no longer time out or leave duplicate items behind, and two people can\'t accidentally run overlapping syncs on the same job. Nothing syncs unless you click Sync.',
      },
      {
        tag: 'New',
        icon: Bell,
        title: 'Get notified when someone comments on your media',
        description:
          'A new Media Comment Notifications section in Settings → Notifications sends you a text and/or email whenever someone comments on a photo or video — including guest replies through share links, like a vendor approving a damage claim. Same controls as your other alerts: pick which projects, and your own comments never notify you. Comments and share-link creation now also show up in each project\'s activity log, so there\'s a full paper trail of who said what and when.',
      },
      {
        tag: 'New',
        icon: Camera,
        title: 'Comments on every photo and video — with video timestamps',
        description:
          'The media viewers on the Images, Videos, and Virtual Calls tabs now keep your media on screen at all times, with Inventory, Notes, and Comments tabs beside it. Your team can discuss any photo or video right where it lives, and replies from people you\'ve shared links with land in the same thread. On videos, starting a comment pauses playback and pins it to that exact moment automatically ("Comment at 0:42") — anyone reading it can tap the timestamp to jump straight there, including on shared links. Cards show a comment count so you can spot new activity at a glance.',
      },
      {
        tag: 'New',
        icon: Link2,
        title: 'Share a single photo or video with anyone',
        description:
          'Every photo and video now has a "Copy share link" option in its three-dot menu — on the Vault, Images, Videos, and Virtual Calls tabs. The link opens just that one item on a branded page (no login needed) where the viewer can watch, see the details, and leave comments. Perfect for texting a damage video to a vendor for a refund claim, showing a crew member where something is, or pasting hand-picked items into notes — without sharing the whole vault.',
      },
      {
        tag: 'Fixed',
        icon: Link2,
        title: 'Crew links sync to your CRM even without an inventory',
        description:
          'Syncing a job with no inventory items (like a designer account or notes-only job) to SmartMoving, Chariot, or MoveRight now still posts the crew review and media vault links into the job notes. Before, those links only went across when the job had at least one inventory item.',
      },
      {
        tag: 'New',
        icon: ShieldCheck,
        title: 'Track crew vault captures from the Dashboard',
        description:
          'The Dashboard has a new Media Vault tab that shows every job that received vault media — crew walk-ins, walk-outs, and damage documentation — in one place, so the office can see what got covered without opening each job. You get totals for the period, a job-by-job breakdown with the latest capture time and labels, and a feed of the newest photos and videos. Click any job to jump straight to its Vault tab.',
      },
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
