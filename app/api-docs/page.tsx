'use client';

// app/api-docs/page.tsx
//
// PUBLIC reference for the external partner API (app/api/external/*) - no
// login required (whitelisted in middleware.ts). Standalone chrome: just the
// Qube Sheets logo up top; "Manage API Keys" links into the app, where Clerk
// requires sign-in.
//
// Endpoint entries are data-driven - when a new external route ships, add one
// object to ENDPOINTS and the nav, params table, request examples, and
// response sample all render from it. Keep samples in sync with the real
// route DTOs.

import { useEffect, useState } from 'react';
import { Check, Copy, Key, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import Logo from '@/components/Logo';
import { toast } from 'sonner';

const PLACEHOLDER_KEY = 'qbs_your_key_id_your_secret';

type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE';

interface EndpointParam {
  name: string;
  kind: 'query' | 'body' | 'path';
  required: boolean;
  description: string;
}

interface RequestExample {
  title: string;
  code: string;
}

interface Endpoint {
  id: string;
  group: string;
  method: HttpMethod;
  path: string;
  title: string;
  description: string;
  notes?: string[];
  params?: EndpointParam[];
  requests: (baseUrl: string) => RequestExample[];
  responseSample: string;
}

const ENDPOINTS: Endpoint[] = [
  // ── Projects ────────────────────────────────────────────────────────────
  {
    id: 'list-projects',
    group: 'Projects',
    method: 'GET',
    path: '/api/external/projects',
    title: 'List projects',
    description: "Your organization's projects, most recently updated first.",
    notes: [
      'Poll for changes cheaply by passing your last check time as updatedSince.',
    ],
    params: [
      { name: 'page', kind: 'query', required: false, description: 'Page number. Default 1.' },
      { name: 'limit', kind: 'query', required: false, description: 'Page size. Default 25, max 100.' },
      { name: 'updatedSince', kind: 'query', required: false, description: 'ISO 8601 timestamp - only projects updated at or after this time.' },
    ],
    requests: (b) => [
      {
        title: 'curl',
        code: `curl "${b}/api/external/projects?limit=25" \\\n  -H "Authorization: Bearer ${PLACEHOLDER_KEY}"`,
      },
    ],
    responseSample: `{
  "projects": [
    {
      "id": "665f1f77bcf86cd799439011",
      "url": "https://app.qubesheets.com/projects/665f1f77bcf86cd799439011",
      "name": "Sarah Johnson",
      "customerName": "Sarah Johnson",
      "customerCompanyName": null,
      "customerEmail": "sarah@example.com",
      "phone": "+15551234567",
      "origin": { "address": "123 Main St, Austin, TX", "unit": "4B" },
      "destination": { "address": "456 Oak Ave, Dallas, TX", "unit": null },
      "createdAt": "2026-10-01T15:21:08.000Z",
      "updatedAt": "2026-10-11T19:02:44.000Z"
    }
  ],
  "pagination": { "page": 1, "limit": 25, "total": 1, "totalPages": 1, "hasMore": false }
}`,
  },
  {
    id: 'create-project',
    group: 'Projects',
    method: 'POST',
    path: '/api/external/projects',
    title: 'Create a project',
    description: 'Creates a project in your organization. When a phone number is included, the customer is automatically texted a video upload link.',
    params: [
      { name: 'customerName', kind: 'body', required: true, description: 'Customer name. Also used as the project name.' },
      { name: 'phone', kind: 'body', required: false, description: '10-digit US phone number. Triggers the upload-link SMS.' },
    ],
    requests: (b) => [
      {
        title: 'curl',
        code: `curl -X POST "${b}/api/external/projects" \\\n  -H "Authorization: Bearer ${PLACEHOLDER_KEY}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"customerName": "John Smith", "phone": "5551234567"}'`,
      },
    ],
    responseSample: `{
  "success": true,
  "message": "Project created successfully",
  "project": {
    "id": "665f1f77bcf86cd799439011",
    "name": "John Smith",
    "customerName": "John Smith",
    "phone": "+15551234567",
    "createdAt": "2026-10-12T10:30:00.000Z",
    "uploadLink": {
      "attempted": true,
      "sent": true,
      "smsDelivered": true,
      "uploadUrl": "https://app.qubesheets.com/customer-upload/abc123...",
      "expiresAt": "2026-10-19T10:30:00.000Z"
    }
  }
}`,
  },

  // ── Inventory & AI ──────────────────────────────────────────────────────
  {
    id: 'inventory',
    group: 'Inventory & AI',
    method: 'GET',
    path: '/api/external/projects/{projectId}/inventory',
    title: 'Get inventory',
    description: "Every inventory item on a project plus going-aware topline totals - the exact numbers your team sees on the project page in Qube Sheets.",
    notes: [
      'cuftPerUnit / weightPerUnitLbs are per single unit; totalCuft / totalWeightLbs are per-unit × quantity.',
      "Summary volume and weight count going units only and include recommended boxes; the WithoutRecommendedBoxes variants exclude them.",
      'going is one of "going", "not going", "partial" - goingQuantity is the number of units actually moving.',
    ],
    params: [
      { name: 'projectId', kind: 'path', required: true, description: 'Project id from List projects or Create a project.' },
    ],
    requests: (b) => [
      {
        title: 'curl',
        code: `curl "${b}/api/external/projects/{projectId}/inventory" \\\n  -H "Authorization: Bearer ${PLACEHOLDER_KEY}"`,
      },
    ],
    responseSample: `{
  "projectId": "665f1f77bcf86cd799439011",
  "projectName": "Sarah Johnson",
  "summary": {
    "rowCount": 42,
    "totalItems": 67,
    "totalBoxes": 25,
    "totalCuft": 812,
    "totalWeightLbs": 5684,
    "totalCuftWithoutRecommendedBoxes": 744,
    "totalWeightLbsWithoutRecommendedBoxes": 5684,
    "totalRooms": 6
  },
  "items": [
    {
      "id": "665f2a88bcf86cd799439aa1",
      "name": "Sofa",
      "description": "3-seat leather sofa",
      "room": "Living Room",
      "category": "Furniture",
      "quantity": 1,
      "going": "going",
      "goingQuantity": 1,
      "cuftPerUnit": 50,
      "totalCuft": 50,
      "weightPerUnitLbs": 350,
      "totalWeightLbs": 350,
      "itemType": "furniture",
      "isBox": false,
      "fragile": false,
      "packedBy": "N/A",
      "specialHandling": null,
      "boxRecommendation": null,
      "tags": [],
      "createdAt": "2026-10-11T18:40:12.000Z",
      "updatedAt": "2026-10-11T19:02:44.000Z"
    }
  ]
}`,
  },
  {
    id: 'ai-summary',
    group: 'Inventory & AI',
    method: 'GET',
    path: '/api/external/projects/{projectId}/ai-summary',
    title: 'Get AI summary',
    description: 'The AI walkthrough summary for each completed video recording on the project.',
    params: [
      { name: 'projectId', kind: 'path', required: true, description: 'Project id.' },
    ],
    requests: (b) => [
      {
        title: 'curl',
        code: `curl "${b}/api/external/projects/{projectId}/ai-summary" \\\n  -H "Authorization: Bearer ${PLACEHOLDER_KEY}"`,
      },
    ],
    responseSample: `{
  "projectId": "665f1f77bcf86cd799439011",
  "recordings": [
    {
      "recordingId": "665f2b11bcf86cd799439bb2",
      "recordedAt": "2026-10-11T18:12:00.000Z",
      "source": "self_serve",
      "summary": "Living room walkthrough: leather sofa and packed boxes identified..."
    }
  ]
}`,
  },
  {
    id: 'packing-notes',
    group: 'Inventory & AI',
    method: 'GET',
    path: '/api/external/projects/{projectId}/packing-notes',
    title: 'Get packing notes',
    description: 'AI-generated packing notes for each completed video recording on the project.',
    params: [
      { name: 'projectId', kind: 'path', required: true, description: 'Project id.' },
    ],
    requests: (b) => [
      {
        title: 'curl',
        code: `curl "${b}/api/external/projects/{projectId}/packing-notes" \\\n  -H "Authorization: Bearer ${PLACEHOLDER_KEY}"`,
      },
    ],
    responseSample: `{
  "projectId": "665f1f77bcf86cd799439011",
  "recordings": [
    {
      "recordingId": "665f2b11bcf86cd799439bb2",
      "recordedAt": "2026-10-11T18:12:00.000Z",
      "source": "self_serve",
      "packingNotes": "Sofa needs shrink wrap; books already packed by owner..."
    }
  ]
}`,
  },
  {
    id: 'customer-statements',
    group: 'Inventory & AI',
    method: 'GET',
    path: '/api/external/projects/{projectId}/customer-statements',
    title: 'Get customer statements',
    description: 'What the customer said during each recorded walkthrough - exact quotes with timestamps, linked to inventory items where the AI made the connection.',
    params: [
      { name: 'projectId', kind: 'path', required: true, description: 'Project id.' },
    ],
    requests: (b) => [
      {
        title: 'curl',
        code: `curl "${b}/api/external/projects/{projectId}/customer-statements" \\\n  -H "Authorization: Bearer ${PLACEHOLDER_KEY}"`,
      },
    ],
    responseSample: `{
  "projectId": "665f1f77bcf86cd799439011",
  "recordings": [
    {
      "recordingId": "665f2b11bcf86cd799439bb2",
      "recordedAt": "2026-10-11T18:12:00.000Z",
      "source": "self_serve",
      "statements": [
        {
          "text": "The sofa is definitely coming with us.",
          "timestamp": "00:15",
          "relatedItem": "Sofa"
        },
        {
          "text": "The treadmill stays, we sold it to the neighbors.",
          "timestamp": "01:45",
          "relatedItem": "Treadmill"
        }
      ]
    }
  ]
}`,
  },

  // ── Review links ────────────────────────────────────────────────────────
  {
    id: 'customer-review-link',
    group: 'Review links',
    method: 'GET',
    path: '/api/external/projects/{projectId}/customer-review-link',
    title: 'Get customer review link',
    description: 'The shareable link where the customer reviews and signs off on their inventory, plus signature status.',
    notes: [
      'Created automatically on first call; repeat calls return the same link.',
      'Nothing is sent to the customer - you decide how the URL reaches them.',
    ],
    params: [
      { name: 'projectId', kind: 'path', required: true, description: 'Project id.' },
    ],
    requests: (b) => [
      {
        title: 'curl',
        code: `curl "${b}/api/external/projects/{projectId}/customer-review-link" \\\n  -H "Authorization: Bearer ${PLACEHOLDER_KEY}"`,
      },
    ],
    responseSample: `{
  "projectId": "665f1f77bcf86cd799439011",
  "reviewUrl": "https://app.qubesheets.com/inventory-review/3b5abf35...",
  "customerName": "Sarah Johnson",
  "customerPhone": "+15551234567",
  "signed": true,
  "signedAt": "2026-10-11T20:15:33.000Z",
  "smsSentAt": null,
  "expiresAt": null,
  "createdAt": "2026-10-11T19:05:01.000Z"
}`,
  },
  {
    id: 'crew-review-link',
    group: 'Review links',
    method: 'GET',
    path: '/api/external/projects/{projectId}/crew-review-link',
    title: 'Get crew review link',
    description: 'The shareable link where the crew views the inventory on moving day.',
    notes: [
      'Created automatically on first call; repeat calls return the same link.',
    ],
    params: [
      { name: 'projectId', kind: 'path', required: true, description: 'Project id.' },
    ],
    requests: (b) => [
      {
        title: 'curl',
        code: `curl "${b}/api/external/projects/{projectId}/crew-review-link" \\\n  -H "Authorization: Bearer ${PLACEHOLDER_KEY}"`,
      },
    ],
    responseSample: `{
  "projectId": "665f1f77bcf86cd799439011",
  "crewReviewUrl": "https://app.qubesheets.com/crew-review/18de497e...",
  "expiresAt": null,
  "createdAt": "2026-10-11T19:05:02.000Z"
}`,
  },

  // ── Virtual calls ───────────────────────────────────────────────────────
  {
    id: 'schedule-call',
    group: 'Virtual calls',
    method: 'POST',
    path: '/api/external/video-calls',
    title: 'Schedule a virtual call',
    description: 'Schedules a new call and automatically sends a confirmation SMS to the customer with their unique join link. Returns both an agent join link (for your team) and a customer join link (already texted to the customer). Attach the call to an existing project with projectId, or create a new project on the fly with customerName.',
    notes: [
      'Assign the call to a rep with assignedToEmail (their Qube Sheets login email) or assignedToUserId (from List users). Assigned calls appear on that rep\'s schedule, the SMS uses their name, and if they\'ve connected Google Calendar the call lands on their calendar. New projects are assigned to the rep too.',
      "Assignment is forgiving: if the email or user id doesn't match anyone in your organization, the call is still created unassigned and the response's assignment object says why - a bad email never blocks a booking.",
      'The customerJoinLink is sent to the customer automatically. Use the agentJoinLink in your own calendar invites or CRM.',
      'Join links are signed tokens that work without a login - valid from creation through 24 hours after the scheduled time.',
      'Pass an IANA timezone (e.g. America/Chicago); the confirmation SMS shows the date/time in that timezone. Phone numbers are 10-digit US and normalized to +1 automatically.',
      'Confirmation SMS uses your company name from Settings → Branding and your custom SMS template if configured.',
    ],
    params: [
      { name: 'projectId', kind: 'body', required: false, description: 'Attach the call to this existing project. Omit to create a new project instead.' },
      { name: 'customerName', kind: 'body', required: false, description: 'Required when creating a new project (no projectId).' },
      { name: 'customerPhone', kind: 'body', required: true, description: '10-digit US phone number. Receives the confirmation SMS.' },
      { name: 'customerEmail', kind: 'body', required: false, description: 'Customer email, stored on the call.' },
      { name: 'scheduledFor', kind: 'body', required: true, description: 'ISO 8601 timestamp, must be in the future.' },
      { name: 'timezone', kind: 'body', required: false, description: 'IANA timezone for the SMS display. Default America/New_York.' },
      { name: 'assignedToEmail', kind: 'body', required: false, description: "Rep's Qube Sheets login email (case-insensitive)." },
      { name: 'assignedToUserId', kind: 'body', required: false, description: "Rep's user id from List users. Wins if both fields are sent." },
    ],
    requests: (b) => [
      {
        title: 'Create new project + schedule call',
        code: `curl -X POST "${b}/api/external/video-calls" \\\n  -H "Authorization: Bearer ${PLACEHOLDER_KEY}" \\\n  -H "Content-Type: application/json" \\\n  -d '{\n    "customerName": "Jane Doe",\n    "customerPhone": "5551234567",\n    "customerEmail": "jane@example.com",\n    "scheduledFor": "2026-06-15T20:00:00.000Z",\n    "timezone": "America/New_York",\n    "assignedToEmail": "rep@yourcompany.com"\n  }'`,
      },
      {
        title: 'Schedule call on existing project',
        code: `curl -X POST "${b}/api/external/video-calls" \\\n  -H "Authorization: Bearer ${PLACEHOLDER_KEY}" \\\n  -H "Content-Type: application/json" \\\n  -d '{\n    "projectId": "507f1f77bcf86cd799439011",\n    "customerPhone": "5551234567",\n    "scheduledFor": "2026-06-15T20:00:00.000Z",\n    "assignedToEmail": "rep@yourcompany.com"\n  }'`,
      },
    ],
    responseSample: `{
  "success": true,
  "message": "Video call scheduled successfully",
  "videoCall": {
    "id": "65f1b2c3d4e5f6a7b8c9d0e1",
    "projectId": "65f1b2c3d4e5f6a7b8c9d0e2",
    "scheduledFor": "2026-06-15T20:00:00.000Z",
    "timezone": "America/New_York",
    "status": "scheduled",
    "customerName": "Jane Doe",
    "customerPhone": "+15551234567",
    "customerEmail": "jane@example.com",
    "assignedTo": {
      "userId": "user_2abc123def456",
      "name": "Jane Smith",
      "email": "rep@yourcompany.com"
    },
    "agentJoinLink": "https://app.qubesheets.com/join/video-call/65f1...?t=...",
    "customerJoinLink": "https://app.qubesheets.com/join/video-call/65f1...?t=...",
    "createdAt": "2026-05-01T12:00:00.000Z"
  },
  "assignment": {
    "requested": "rep@yourcompany.com",
    "assigned": true,
    "calendarEventCreated": true
  },
  "confirmationSms": {
    "attempted": true,
    "delivered": true
  }
}`,
  },
  {
    id: 'list-calls',
    group: 'Virtual calls',
    method: 'GET',
    path: '/api/external/video-calls',
    title: 'List virtual calls',
    description: "Your organization's scheduled video calls, with filters for status, project, date range, and assignee.",
    notes: [
      "Filter to one rep's calls with assignedTo - pass a user id or email, e.g. ?assignedTo=rep@yourcompany.com&upcoming=true.",
    ],
    params: [
      { name: 'upcoming', kind: 'query', required: false, description: 'true - only future calls.' },
      { name: 'status', kind: 'query', required: false, description: 'Filter by call status, e.g. scheduled, cancelled.' },
      { name: 'projectId', kind: 'query', required: false, description: 'Only calls on this project.' },
      { name: 'startDate', kind: 'query', required: false, description: 'ISO 8601 - calls scheduled at or after this time.' },
      { name: 'endDate', kind: 'query', required: false, description: 'ISO 8601 - calls scheduled at or before this time.' },
      { name: 'assignedTo', kind: 'query', required: false, description: 'User id or email - only that rep\'s calls.' },
      { name: 'limit', kind: 'query', required: false, description: 'Page size.' },
      { name: 'skip', kind: 'query', required: false, description: 'Number of results to skip (offset pagination).' },
    ],
    requests: (b) => [
      {
        title: 'curl',
        code: `curl "${b}/api/external/video-calls?upcoming=true&limit=20" \\\n  -H "Authorization: Bearer ${PLACEHOLDER_KEY}"`,
      },
    ],
    responseSample: `{
  "success": true,
  "videoCalls": [
    {
      "id": "65f1b2c3d4e5f6a7b8c9d0e1",
      "projectId": "65f1b2c3d4e5f6a7b8c9d0e2",
        "scheduledFor": "2026-06-15T20:00:00.000Z",
      "timezone": "America/New_York",
      "status": "scheduled",
      "customerName": "Jane Doe",
      "customerPhone": "+15551234567",
      "customerEmail": "jane@example.com",
      "assignedTo": {
        "userId": "user_2abc123def456",
        "name": "Jane Smith",
        "email": "rep@yourcompany.com"
      },
      "agentJoinLink": "https://app.qubesheets.com/join/video-call/...",
      "customerJoinLink": "https://app.qubesheets.com/join/video-call/...",
      "createdAt": "2026-05-01T12:00:00.000Z",
      "updatedAt": "2026-05-01T12:00:00.000Z"
    }
  ],
  "pagination": { "total": 1, "limit": 20, "skip": 0, "returned": 1 }
}`,
  },
  {
    id: 'get-call',
    group: 'Virtual calls',
    method: 'GET',
    path: '/api/external/video-calls/{callId}',
    title: 'Get a virtual call',
    description: 'A single video call, including the SMS reminders already sent to the customer.',
    params: [
      { name: 'callId', kind: 'path', required: true, description: 'Video call id.' },
    ],
    requests: (b) => [
      {
        title: 'curl',
        code: `curl "${b}/api/external/video-calls/{callId}" \\\n  -H "Authorization: Bearer ${PLACEHOLDER_KEY}"`,
      },
    ],
    responseSample: `{
  "success": true,
  "videoCall": {
    "id": "65f1b2c3d4e5f6a7b8c9d0e1",
    "projectId": "65f1b2c3d4e5f6a7b8c9d0e2",
    "scheduledFor": "2026-06-15T20:00:00.000Z",
    "timezone": "America/New_York",
    "status": "scheduled",
    "customerName": "Jane Doe",
    "customerPhone": "+15551234567",
    "customerEmail": "jane@example.com",
    "assignedTo": {
      "userId": "user_2abc123def456",
      "name": "Jane Smith",
      "email": "rep@yourcompany.com"
    },
    "agentJoinLink": "https://app.qubesheets.com/join/video-call/...",
    "customerJoinLink": "https://app.qubesheets.com/join/video-call/...",
    "remindersSent": [
      { "type": "confirmation", "sentAt": "2026-05-01T12:00:01.000Z", "method": "sms" }
    ],
    "createdAt": "2026-05-01T12:00:00.000Z",
    "updatedAt": "2026-05-01T12:00:00.000Z"
  }
}`,
  },
  {
    id: 'update-call',
    group: 'Virtual calls',
    method: 'PATCH',
    path: '/api/external/video-calls/{callId}',
    title: 'Reschedule or reassign a call',
    description: 'Updates a scheduled call. Provide scheduledFor to reschedule, assignedToEmail / assignedToUserId to reassign it to a different team member, or both at once. Only calls with status scheduled can be updated.',
    notes: [
      "Rescheduling automatically sends a reschedule SMS to the customer with their (still valid) join link, and moves the rep's Google Calendar event if one exists.",
      "Reassigning moves the call to the new rep's schedule (and their Google Calendar, if connected). No SMS is sent for a reassignment alone.",
    ],
    params: [
      { name: 'callId', kind: 'path', required: true, description: 'Video call id.' },
      { name: 'scheduledFor', kind: 'body', required: false, description: 'New ISO 8601 time, must be in the future.' },
      { name: 'timezone', kind: 'body', required: false, description: 'IANA timezone for the reschedule SMS display.' },
      { name: 'assignedToEmail', kind: 'body', required: false, description: "New rep's Qube Sheets login email." },
      { name: 'assignedToUserId', kind: 'body', required: false, description: "New rep's user id. Wins if both fields are sent." },
    ],
    requests: (b) => [
      {
        title: 'Reschedule',
        code: `curl -X PATCH "${b}/api/external/video-calls/{callId}" \\\n  -H "Authorization: Bearer ${PLACEHOLDER_KEY}" \\\n  -H "Content-Type: application/json" \\\n  -d '{\n    "scheduledFor": "2026-06-16T21:00:00.000Z",\n    "timezone": "America/New_York"\n  }'`,
      },
      {
        title: 'Reassign only',
        code: `curl -X PATCH "${b}/api/external/video-calls/{callId}" \\\n  -H "Authorization: Bearer ${PLACEHOLDER_KEY}" \\\n  -H "Content-Type: application/json" \\\n  -d '{ "assignedToEmail": "otherrep@yourcompany.com" }'`,
      },
    ],
    responseSample: `{
  "success": true,
  "message": "Video call rescheduled successfully",
  "videoCall": {
    "id": "65f1b2c3d4e5f6a7b8c9d0e1",
    "projectId": "65f1b2c3d4e5f6a7b8c9d0e2",
    "scheduledFor": "2026-06-16T21:00:00.000Z",
    "timezone": "America/New_York",
    "status": "scheduled",
    "assignedTo": {
      "userId": "user_2abc123def456",
      "name": "Jane Smith",
      "email": "rep@yourcompany.com"
    },
    "agentJoinLink": "https://app.qubesheets.com/join/video-call/...",
    "customerJoinLink": "https://app.qubesheets.com/join/video-call/..."
  },
  "rescheduleSms": {
    "attempted": true,
    "delivered": true
  }
}`,
  },
  {
    id: 'cancel-call',
    group: 'Virtual calls',
    method: 'DELETE',
    path: '/api/external/video-calls/{callId}',
    title: 'Cancel a call',
    description: 'Cancels a scheduled call. Optionally sends a cancellation SMS to the customer. Only calls with status scheduled can be cancelled.',
    params: [
      { name: 'callId', kind: 'path', required: true, description: 'Video call id.' },
      { name: 'sendSms', kind: 'body', required: false, description: 'true - text the customer a cancellation notice. Default false.' },
    ],
    requests: (b) => [
      {
        title: 'curl',
        code: `curl -X DELETE "${b}/api/external/video-calls/{callId}" \\\n  -H "Authorization: Bearer ${PLACEHOLDER_KEY}" \\\n  -H "Content-Type: application/json" \\\n  -d '{ "sendSms": true }'`,
      },
    ],
    responseSample: `{
  "success": true,
  "message": "Video call cancelled",
  "videoCall": {
    "id": "65f1b2c3d4e5f6a7b8c9d0e1",
    "status": "cancelled"
  },
  "cancellationSms": {
    "attempted": true,
    "delivered": true
  }
}`,
  },

  // ── Capture links ───────────────────────────────────────────────────────
  {
    id: 'self-survey-link',
    group: 'Capture links',
    method: 'GET',
    path: '/api/external/projects/{projectId}/self-survey-link',
    title: 'Get customer self-survey link',
    description: 'The link where the customer records their own video walkthrough - the same URL the app texts when you create a project with a phone number.',
    notes: [
      'Returns the active unexpired link if one exists; otherwise creates a fresh one with a 7-day expiry. An expired link is replaced on the next call.',
      'Nothing is texted - you decide how the URL reaches the customer.',
    ],
    params: [
      { name: 'projectId', kind: 'path', required: true, description: 'Project id.' },
    ],
    requests: (b) => [
      {
        title: 'curl',
        code: `curl "${b}/api/external/projects/{projectId}/self-survey-link" \\\n  -H "Authorization: Bearer ${PLACEHOLDER_KEY}"`,
      },
    ],
    responseSample: `{
  "projectId": "665f1f77bcf86cd799439011",
  "selfSurveyUrl": "https://app.qubesheets.com/customer-upload/9f2c41d8...",
  "customerName": "Sarah Johnson",
  "customerPhone": "+15551234567",
  "expiresAt": "2026-10-19T10:30:00.000Z",
  "createdAt": "2026-10-12T10:30:00.000Z"
}`,
  },
  {
    id: 'onsite-walkthrough-link',
    group: 'Capture links',
    method: 'GET',
    path: '/api/external/projects/{projectId}/onsite-walkthrough-link',
    title: 'Get on-site walkthrough link',
    description: 'The link your surveyor opens to record a walkthrough on site. Same capture UI as the self-survey, but customer SMS notifications are suppressed and completion returns to the project, since the person recording is your team member.',
    notes: [
      'Created automatically on first call; repeat calls return the same link. Walkthrough links never expire.',
    ],
    params: [
      { name: 'projectId', kind: 'path', required: true, description: 'Project id.' },
    ],
    requests: (b) => [
      {
        title: 'curl',
        code: `curl "${b}/api/external/projects/{projectId}/onsite-walkthrough-link" \\\n  -H "Authorization: Bearer ${PLACEHOLDER_KEY}"`,
      },
    ],
    responseSample: `{
  "projectId": "665f1f77bcf86cd799439011",
  "walkthroughUrl": "https://app.qubesheets.com/customer-upload/4a7be1c2...",
  "createdAt": "2026-10-12T10:30:00.000Z"
}`,
  },

  // ── Media ───────────────────────────────────────────────────────────────
  {
    id: 'media',
    group: 'Media',
    method: 'GET',
    path: '/api/external/projects/{projectId}/media',
    title: 'Get media',
    description: "Every photo and video captured for a project, each with a signed download URL. Built for programmatic sync: GET each url to download the raw file bytes and store them in your own system (e.g. attach to the matching record in your CRM). Vault reference media is excluded. Same shape as the webhook payload's media section.",
    notes: [
      'Each url is a plain GET that returns the actual file bytes (image/jpeg, video/mp4) - no login and no API key needed on the download itself; the signed url is the credential. Stream the response straight into your own storage.',
      'Download URLs expire 24 hours after this response (urlsExpireAt) - call this endpoint again any time for fresh ones, and never store the URLs themselves as permanent references (store the downloaded files, keyed by the stable media id).',
      'Each URL streams the file directly from the API (photos and videos alike); video URLs support HTTP Range requests for seeking, resuming, and chunked downloads of large recordings.',
      'videos covers both customer uploads (source customer_upload) and call/self-serve recordings (source video_call / self_serve).',
    ],
    params: [
      { name: 'projectId', kind: 'path', required: true, description: 'Project id.' },
    ],
    requests: (b) => [
      {
        title: '1. List media',
        code: `curl "${b}/api/external/projects/{projectId}/media" \\\n  -H "Authorization: Bearer ${PLACEHOLDER_KEY}"`,
      },
      {
        title: '2. Download a file (no auth header needed)',
        code: `# take any url from the response above and save the bytes:\ncurl -L -o living-room.jpg "${b}/api/external/media/eyJvIjoi..."`,
      },
    ],
    responseSample: `{
  "projectId": "665f1f77bcf86cd799439011",
  "images": [
    {
      "id": "665f2d44bcf86cd799439dd1",
      "name": "living-room.jpg",
      "contentType": "image/jpeg",
      "sizeBytes": 245120,
      "capturedAt": "2026-10-11T18:05:44.000Z",
      "url": "https://app.qubesheets.com/api/external/media/eyJvIjoi..."
    }
  ],
  "videos": [
    {
      "id": "665f2b11bcf86cd799439bb2",
      "name": null,
      "source": "self_serve",
      "durationSec": 184,
      "recordedAt": "2026-10-11T18:12:00.000Z",
      "url": "https://app.qubesheets.com/api/external/media/eyJvIjoi..."
    }
  ],
  "urlsExpireAt": "2026-10-12T18:30:00.000Z"
}`,
  },

  // ── Team ────────────────────────────────────────────────────────────────
  {
    id: 'list-users',
    group: 'Team',
    method: 'GET',
    path: '/api/external/users',
    title: 'List users',
    description: 'The members of your organization. Use the returned id (as assignedToUserId) or email (as assignedToEmail) to assign video calls to a specific team member.',
    notes: [
      "Email matching on call assignment is case-insensitive against the member's Qube Sheets login email - if your CRM stores a different address for the same person, fetch the correct emails here or assign by assignedToUserId instead.",
    ],
    requests: (b) => [
      {
        title: 'curl',
        code: `curl "${b}/api/external/users" \\\n  -H "Authorization: Bearer ${PLACEHOLDER_KEY}"`,
      },
    ],
    responseSample: `{
  "success": true,
  "users": [
    {
      "id": "user_2abc123def456",
      "email": "rep@yourcompany.com",
      "firstName": "Jane",
      "lastName": "Smith",
      "name": "Jane Smith",
      "role": "member"
    }
  ],
  "total": 1
}`,
  },
];

const GROUPS = Array.from(new Set(ENDPOINTS.map((e) => e.group)));

const ERROR_ROWS = [
  { code: '400', meaning: 'Invalid request - a parameter failed validation (the message says which), e.g. a scheduledFor in the past.' },
  { code: '401', meaning: 'Missing or invalid API key.' },
  { code: '404', meaning: 'Project or video call not found, or it belongs to a different organization.' },
  { code: '500', meaning: 'Something went wrong on our side - safe to retry.' },
];

const METHOD_BADGE_CLASSES: Record<HttpMethod, string> = {
  GET: 'bg-emerald-500/10 text-emerald-700 ring-emerald-600/20',
  POST: 'bg-blue-500/10 text-blue-700 ring-blue-600/20',
  PATCH: 'bg-amber-500/10 text-amber-700 ring-amber-600/20',
  DELETE: 'bg-red-500/10 text-red-700 ring-red-600/20',
};

function MethodBadge({ method }: { method: HttpMethod }) {
  return (
    <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-bold tracking-wide ring-1 ring-inset ${METHOD_BADGE_CLASSES[method]}`}>
      {method}
    </span>
  );
}

function escapeHtml(code: string): string {
  return code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Tiny single-pass highlighter for the page's own static samples. Input is
 * escaped first and only our span tags are injected, so the HTML is safe.
 */
function highlightCode(code: string, lang: 'shell' | 'json'): string {
  const esc = escapeHtml(code);
  if (lang === 'json') {
    return esc.replace(
      /("(?:[^"\\]|\\.)*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?)/g,
      (match, str, colon, keyword, num) => {
        if (str) {
          return colon
            ? `<span class="text-sky-300">${str}</span>${colon}`
            : `<span class="text-emerald-300">${str}</span>`;
        }
        if (keyword) return `<span class="text-fuchsia-300">${keyword}</span>`;
        if (num) return `<span class="text-amber-300">${num}</span>`;
        return match;
      }
    );
  }
  return esc.replace(
    /^(curl)\b|(\s-[A-Za-z]+\b)|("(?:[^"\\]|\\.)*")|('(?:[^'\\]|\\.)*')/gm,
    (match, curl, flag, dq, sq) => {
      if (curl) return `<span class="text-sky-300">${curl}</span>`;
      if (flag) return `<span class="text-fuchsia-300">${flag}</span>`;
      if (dq || sq) return `<span class="text-emerald-300">${dq || sq}</span>`;
      return match;
    }
  );
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          toast.success(`${label} copied`);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          toast.error('Could not copy to clipboard');
        }
      }}
      className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-gray-400 hover:text-gray-100 hover:bg-gray-700 transition-colors"
      aria-label={`Copy ${label}`}
    >
      {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

function CodeBlock({ title, code, lang = 'shell' }: { title: string; code: string; lang?: 'shell' | 'json' }) {
  return (
    <div className="overflow-hidden rounded-xl bg-slate-950 ring-1 ring-slate-800">
      <div className="flex items-center justify-between border-b border-slate-800/80 bg-slate-900/60 px-3 py-2">
        <div className="flex items-center gap-2.5">
          <div className="flex gap-1.5" aria-hidden="true">
            <span className="h-2.5 w-2.5 rounded-full bg-slate-700" />
            <span className="h-2.5 w-2.5 rounded-full bg-slate-700" />
            <span className="h-2.5 w-2.5 rounded-full bg-slate-700" />
          </div>
          <span className="text-xs font-medium text-slate-400">{title}</span>
        </div>
        <CopyButton text={code} label={title} />
      </div>
      <pre className="max-h-80 overflow-x-auto p-4 text-xs leading-relaxed text-slate-100">
        <code dangerouslySetInnerHTML={{ __html: highlightCode(code, lang) }} />
      </pre>
    </div>
  );
}

function ParamsTable({ params }: { params: EndpointParam[] }) {
  return (
    <div className="overflow-hidden rounded-xl ring-1 ring-gray-200">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 text-left text-[11px] uppercase tracking-wider text-gray-500">
              <th className="px-4 py-2.5 font-semibold">Parameter</th>
              <th className="px-4 py-2.5 font-semibold">In</th>
              <th className="px-4 py-2.5 font-semibold">Required</th>
              <th className="px-4 py-2.5 font-semibold">Description</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {params.map((p) => (
              <tr key={p.name} className="transition-colors hover:bg-gray-50/70">
                <td className="px-4 py-2.5 font-mono text-xs font-medium text-gray-900">{p.name}</td>
                <td className="px-4 py-2.5 text-xs text-gray-500">{p.kind}</td>
                <td className="px-4 py-2.5">
                  {p.required ? (
                    <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700 ring-1 ring-inset ring-amber-600/20">required</span>
                  ) : (
                    <span className="text-xs text-gray-400">optional</span>
                  )}
                </td>
                <td className="px-4 py-2.5 text-xs text-gray-600">{p.description}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function ApiDocsPage() {
  // Always the production URL - docs are shared with partners, so examples
  // must never show a dev or preview origin.
  const baseUrl = 'https://app.qubesheets.com';
  const [activeId, setActiveId] = useState('getting-started');
  const [query, setQuery] = useState('');

  const q = query.trim().toLowerCase();
  const searching = q.length > 0;
  const visibleEndpoints = searching
    ? ENDPOINTS.filter((e) =>
        `${e.method} ${e.path} ${e.title} ${e.description} ${e.group}`.toLowerCase().includes(q)
      )
    : ENDPOINTS;
  const visibleGroups = GROUPS.filter((g) => visibleEndpoints.some((e) => e.group === g));

  // Scrollspy: highlight the nav item for the section nearest the top.
  // Re-observe when the search filter changes which sections are mounted.
  useEffect(() => {
    document.documentElement.style.scrollBehavior = 'smooth';
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveId(entry.target.id);
            break;
          }
        }
      },
      { rootMargin: '-96px 0px -75% 0px' }
    );
    const ids = ['getting-started', ...ENDPOINTS.map((e) => e.id), 'webhooks', 'errors'];
    ids.forEach((id) => {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    });
    return () => {
      observer.disconnect();
      document.documentElement.style.scrollBehavior = '';
    };
  }, [q]);

  const navLink = (id: string, label: string, method?: HttpMethod) => (
    <a
      key={id}
      href={`#${id}`}
      className={`flex items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-sm transition-colors ${
        activeId === id
          ? 'bg-blue-50 font-medium text-blue-700'
          : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
      }`}
    >
      <span className="truncate">{label}</span>
      {method && (
        <span className={`shrink-0 rounded px-1 py-px text-[9px] font-bold tracking-wide ring-1 ring-inset ${METHOD_BADGE_CLASSES[method]}`}>
          {method}
        </span>
      )}
    </a>
  );

  const searchInput = (
    <div className="relative">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search endpoints..."
        className="w-full rounded-lg bg-white py-2 pl-9 pr-3 text-sm text-gray-900 shadow-sm ring-1 ring-gray-200 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
        aria-label="Search endpoints"
      />
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Top bar - logo only; Manage API Keys goes into the app (login required there) */}
      <header className="sticky top-0 z-20 border-b border-gray-200/80 bg-white/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6">
          <a href="/" aria-label="Qube Sheets home">
            <Logo showText size="lg" />
          </a>
          <Button
            size="sm"
            onClick={() => window.location.href = '/settings/api-keys'}
          >
            <Key className="h-4 w-4 mr-1.5" />
            Manage API Keys
          </Button>
        </div>
      </header>

      {/* Hero */}
      <div className="relative isolate overflow-hidden bg-slate-950">
        <div className="absolute -top-28 left-1/4 h-72 w-72 rounded-full bg-blue-600/30 blur-3xl" aria-hidden="true" />
        <div className="absolute -bottom-36 right-1/5 h-80 w-80 rounded-full bg-indigo-500/20 blur-3xl" aria-hidden="true" />
        <div className="relative mx-auto max-w-6xl px-4 py-14 sm:px-6">
          <span className="inline-flex items-center rounded-full bg-blue-500/10 px-3 py-1 text-xs font-medium text-blue-300 ring-1 ring-inset ring-blue-400/30">
            Open API
          </span>
          <h1 className="mt-4 text-3xl font-bold tracking-tight text-white sm:text-4xl">API Documentation</h1>
          <p className="mt-3 max-w-2xl text-slate-300">
            Build custom workflows for your team with our open API. Looking for something specific? Reach out to us for support.
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-2.5 text-xs">
            <span className="inline-flex items-center rounded-lg bg-white/5 px-3 py-1.5 font-mono text-slate-200 ring-1 ring-inset ring-white/10">
              {baseUrl}
            </span>
            <span className="inline-flex items-center rounded-lg bg-white/5 px-3 py-1.5 text-slate-300 ring-1 ring-inset ring-white/10">
              Bearer token auth
            </span>
            <span className="inline-flex items-center rounded-lg bg-white/5 px-3 py-1.5 text-slate-300 ring-1 ring-inset ring-white/10">
              JSON everywhere
            </span>
          </div>
        </div>
      </div>

      <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        <div className="flex gap-10">
        {/* Section nav (desktop) */}
        <nav className="hidden w-60 shrink-0 lg:block">
          <div className="sticky top-24 max-h-[calc(100vh-7rem)] space-y-4 overflow-y-auto pb-6 text-sm">
            {searchInput}
            {!searching && navLink('getting-started', 'Getting started')}
            {visibleGroups.map((group) => (
              <div key={group} className="space-y-0.5">
                <p className="px-2.5 pb-1 text-[11px] font-semibold uppercase tracking-widest text-gray-400">{group}</p>
                {visibleEndpoints.filter((e) => e.group === group).map((e) => navLink(e.id, e.title, e.method))}
              </div>
            ))}
            {searching && visibleEndpoints.length === 0 && (
              <p className="px-2.5 text-xs text-gray-400">No matches</p>
            )}
            {!searching && navLink('webhooks', 'Webhooks')}
            {!searching && navLink('mcp', 'AI assistants (MCP)')}
            {!searching && navLink('errors', 'Errors')}
          </div>
        </nav>

        <div className="min-w-0 flex-1 space-y-6">
          {/* Search (mobile - the desktop input lives in the sidebar) */}
          <div className="lg:hidden">{searchInput}</div>

          {/* Getting started */}
          {!searching && (
          <section id="getting-started" className="scroll-mt-24 rounded-xl bg-white p-6 shadow-sm ring-1 ring-gray-950/5">
            <h2 className="text-lg font-semibold mb-1">Getting started</h2>
            <p className="text-sm text-gray-600 mb-4">
              Three steps to your first request. Looking for something specific?{' '}
              Reach out to us for support - we're happy to help.
            </p>

            <ol className="space-y-4">
              <li className="flex gap-3">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 text-xs font-semibold text-white shadow-sm">1</span>
                <div className="min-w-0">
                  <p className="text-sm font-medium">Create an API key</p>
                  <p className="text-xs text-gray-600">
                    Go to{' '}
                    <a href="/settings/api-keys" className="text-blue-600 hover:underline">Settings → API Keys</a>,
                    name your key, and create it. It's shown once - store it somewhere safe. Keys are scoped to your organization.
                  </p>
                </div>
              </li>
              <li className="flex gap-3">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 text-xs font-semibold text-white shadow-sm">2</span>
                <div className="min-w-0">
                  <p className="text-sm font-medium">Send it as a Bearer token</p>
                  <p className="text-xs text-gray-600 mb-2">Every request includes the same header:</p>
                  <CodeBlock title="Header" code={`Authorization: Bearer ${PLACEHOLDER_KEY}`} />
                </div>
              </li>
              <li className="flex gap-3">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 text-xs font-semibold text-white shadow-sm">3</span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">Make your first request</p>
                  <p className="text-xs text-gray-600 mb-2">List your projects to grab a project id:</p>
                  <CodeBlock
                    title="curl"
                    code={`curl "${baseUrl}/api/external/projects" \\\n  -H "Authorization: Bearer ${PLACEHOLDER_KEY}"`}
                  />
                </div>
              </li>
            </ol>

            <div className="mt-5 grid gap-2 sm:grid-cols-2 text-xs text-gray-600">
              <div className="rounded-xl bg-gray-50 p-3 ring-1 ring-gray-200">
                <p className="font-medium text-gray-700 mb-0.5">Base URL</p>
                <code className="font-mono">{baseUrl}</code>
              </div>
              <div className="rounded-xl bg-gray-50 p-3 ring-1 ring-gray-200">
                <p className="font-medium text-gray-700 mb-0.5">Format</p>
                JSON everywhere. Timestamps are ISO 8601 (UTC), timezones are IANA names, volume is cubic feet, weight is pounds, phone numbers are 10-digit US (normalized to +1).
              </div>
            </div>
          </section>
          )}

          {/* Endpoints, grouped */}
          {visibleGroups.map((group) => (
            <div key={group} className="pt-2">
              <div className="mb-3 flex items-center gap-2.5">
                <h2 className="text-sm font-semibold tracking-wide text-gray-800">{group}</h2>
                <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-500">
                  {visibleEndpoints.filter((e) => e.group === group).length}
                </span>
              </div>
              <div className="space-y-6">
              {visibleEndpoints.filter((e) => e.group === group).map((e) => (
                <section key={e.id} id={e.id} className="scroll-mt-24 rounded-xl bg-white p-6 shadow-sm ring-1 ring-gray-950/5">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <MethodBadge method={e.method} />
                    <code className="break-all font-mono text-[13px] text-gray-800">{e.path}</code>
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(`${baseUrl}${e.path}`);
                          toast.success('Endpoint URL copied');
                        } catch {
                          toast.error('Could not copy to clipboard');
                        }
                      }}
                      className="text-gray-300 transition-colors hover:text-gray-500"
                      aria-label={`Copy URL for ${e.title}`}
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <h3 className="text-lg font-semibold text-gray-900">{e.title}</h3>
                  <p className="mt-1 text-sm text-gray-600">{e.description}</p>

                  {e.notes && e.notes.length > 0 && (
                    <ul className="mt-3 space-y-1">
                      {e.notes.map((note, i) => (
                        <li key={i} className="text-xs text-gray-600 flex gap-1.5">
                          <span className="text-blue-500 mt-0.5">•</span>
                          {note}
                        </li>
                      ))}
                    </ul>
                  )}

                  {e.params && e.params.length > 0 && (
                    <div className="mt-4">
                      <ParamsTable params={e.params} />
                    </div>
                  )}

                  <div className="mt-4 grid gap-3 xl:grid-cols-2">
                    <div className="space-y-3 min-w-0">
                      {e.requests(baseUrl).map((req) => (
                        <CodeBlock key={req.title} title={req.title} code={req.code} />
                      ))}
                    </div>
                    <div className="min-w-0">
                      <CodeBlock title="Example response" code={e.responseSample} lang="json" />
                    </div>
                  </div>
                </section>
              ))}
              </div>
            </div>
          ))}

          {/* Empty search state */}
          {searching && visibleEndpoints.length === 0 && (
            <div className="rounded-xl bg-white p-10 text-center shadow-sm ring-1 ring-gray-950/5">
              <p className="text-sm font-medium text-gray-900">No endpoints match "{query}"</p>
              <p className="mt-1 text-xs text-gray-500">Try a method (GET, POST), a path, or a keyword like inventory or link.</p>
            </div>
          )}

          {/* Webhooks */}
          {!searching && (
          <section id="webhooks" className="scroll-mt-24 rounded-xl bg-white p-6 shadow-sm ring-1 ring-gray-950/5">
            <h2 className="text-lg font-semibold mb-1">Webhooks</h2>
            <p className="text-sm text-gray-600">
              Get inventory pushed to you instead of polling{' '}
              <code className="text-xs font-mono bg-gray-100 px-1 py-0.5 rounded">GET /api/external/projects/{'{projectId}'}/inventory</code>.
              Whenever an AI analysis finishes writing a project's inventory - from virtual call
              walkthroughs, self-serve walkthroughs, or customer photo/video uploads - Qube Sheets
              POSTs an <code className="text-xs font-mono bg-gray-100 px-1 py-0.5 rounded">inventory.ready</code>{' '}
              event to each of your active endpoints. You choose per endpoint which sections ride in the{' '}
              <code className="text-xs font-mono bg-gray-100 px-1 py-0.5 rounded">data</code> field:
              inventory summary and items (on by default, same shapes as Get inventory), review links
              (customerReview + crewReview URLs), AI summary, packing notes, customer statements
              (same shapes as their GET endpoints), and media.
            </p>
            <ul className="mt-3 space-y-1">
              <li className="text-xs text-gray-600 flex gap-1.5">
                <span className="text-blue-500 mt-0.5">•</span>
                Set up from the app: Settings, then Webhooks (org admins only - endpoints are not
                configurable through this API). Each endpoint gets a signing secret (whsec_...)
                shown once at creation; store it somewhere safe.
              </li>
              <li className="text-xs text-gray-600 flex gap-1.5">
                <span className="text-blue-500 mt-0.5">•</span>
                initialInventory is true on the first successful inventory delivery for a project to
                your endpoint - use it to tell "new inventory" from "inventory updated".
              </li>
              <li className="text-xs text-gray-600 flex gap-1.5">
                <span className="text-blue-500 mt-0.5">•</span>
                The project block carries the customer name, contact details, and addresses — the
                same object shape List projects returns — so you can match the delivery to your own
                records without a follow-up API call.
              </li>
              <li className="text-xs text-gray-600 flex gap-1.5">
                <span className="text-blue-500 mt-0.5">•</span>
                Bursts are coalesced: when many analyses finish close together (say a 30-photo
                batch), you get one delivery about 25 seconds after the last one completes, and
                every section is rebuilt from current data at send time.
              </li>
              <li className="text-xs text-gray-600 flex gap-1.5">
                <span className="text-blue-500 mt-0.5">•</span>
                The media section lists every non-vault photo and video with a signed download URL.
                GET each url to download the raw file bytes (no API key needed on the download —
                the signed url is the credential) and store them in your own app, keyed by the
                stable media id. URLs expire 24 hours after the delivery (data.media.urlsExpireAt)
                and die immediately if the endpoint is deleted, so download promptly (or re-list via
                GET /api/external/projects/:id/media for fresh URLs) and never treat the URLs
                themselves as permanent references.
              </li>
              <li className="text-xs text-gray-600 flex gap-1.5">
                <span className="text-blue-500 mt-0.5">•</span>
                Verify your receiver anytime by sending a webhook.test event (same envelope, sample
                data) from the settings page.
              </li>
            </ul>
            <div className="mt-4 grid gap-3 xl:grid-cols-2">
              <div className="space-y-3 min-w-0">
                <CodeBlock
                  title="Request headers"
                  code={`POST https://your-server.example.com/qubesheets-webhook\nContent-Type: application/json\nUser-Agent: QubeSheets-Webhooks/1.0\nX-Qubesheets-Event: inventory.ready\nX-Qubesheets-Delivery: 665f3c99bcf86cd799439cc3\nX-Qubesheets-Timestamp: 1791745390\nX-Qubesheets-Signature: v1=bfc7dd7386a075c7d6c0607c6d11a6a81dfbe4537a99606830d459cc961aee20`}
                />
                <CodeBlock
                  title="Verify the signature (Node.js)"
                  code={`const crypto = require('crypto');

function verifyQubeSheetsSignature(req, rawBody, secret) {
  const timestamp = req.headers['x-qubesheets-timestamp'];
  const signature = req.headers['x-qubesheets-signature']; // "v1=<hex>"
  const expected = 'v1=' + crypto.createHmac('sha256', secret)
    .update(\`\${timestamp}.\${rawBody}\`)
    .digest('hex');
  const fresh = Math.abs(Date.now() / 1000 - Number(timestamp)) < 300;
  // timingSafeEqual throws on length mismatch — compare lengths first so a
  // missing or malformed header returns false instead of crashing.
  const a = Buffer.from(signature || '');
  const b = Buffer.from(expected);
  return fresh && a.length === b.length && crypto.timingSafeEqual(a, b);
}`}
                />
              </div>
              <div className="min-w-0">
                <CodeBlock
                  title="Example delivery"
                  lang="json"
                  code={`{
  "id": "evt_665f3c99bcf86cd799439cc3",
  "event": "inventory.ready",
  "createdAt": "2026-10-11T19:03:10.000Z",
  "initialInventory": true,
  "project": {
    "id": "665f1f77bcf86cd799439011",
    "url": "https://app.qubesheets.com/projects/665f1f77bcf86cd799439011",
    "name": "Sarah Johnson",
    "customerName": "Sarah Johnson",
    "customerCompanyName": null,
    "customerEmail": "sarah@example.com",
    "phone": "+15551234567",
    "origin": { "address": "123 Main St, Austin, TX", "unit": "4B" },
    "destination": { "address": "456 Oak Ave, Dallas, TX", "unit": null },
    "createdAt": "2026-10-01T15:21:08.000Z",
    "updatedAt": "2026-10-11T19:02:44.000Z"
  },
  "data": {
    "projectId": "665f1f77bcf86cd799439011",
    "projectName": "Sarah Johnson",
    "summary": {
      "rowCount": 42,
      "totalItems": 67,
      "totalBoxes": 25,
      "totalCuft": 812,
      "totalWeightLbs": 5684,
      "totalCuftWithoutRecommendedBoxes": 744,
      "totalWeightLbsWithoutRecommendedBoxes": 5684,
      "totalRooms": 6
    },
    "items": [
      {
        "id": "665f2a88bcf86cd799439aa1",
        "name": "Sofa",
        "description": "3-seat leather sofa",
        "room": "Living Room",
        "category": "Furniture",
        "quantity": 1,
        "going": "going",
        "goingQuantity": 1,
        "cuftPerUnit": 50,
        "totalCuft": 50,
        "weightPerUnitLbs": 350,
        "totalWeightLbs": 350,
        "itemType": "furniture",
        "isBox": false,
        "fragile": false,
        "packedBy": "N/A",
        "specialHandling": null,
        "boxRecommendation": null,
        "tags": [],
        "createdAt": "2026-10-11T18:40:12.000Z",
        "updatedAt": "2026-10-11T19:02:44.000Z"
      }
    ]
  }
}`}
                />
              </div>
            </div>
            <p className="mt-4 text-xs text-gray-500">
              The signature is an HMAC-SHA256 over{' '}
              <code className="font-mono bg-gray-100 px-1 py-0.5 rounded">{'<timestamp>.<raw request body>'}</code>{' '}
              keyed with your endpoint's signing secret - always verify against the raw bytes before
              parsing the JSON. Respond with any 2xx within 10 seconds and do heavy work
              asynchronously; a non-2xx response or timeout is retried up to 5 attempts total with
              backoff of roughly 1m, 5m, 15m, then 1h (timing is approximate). After 10 consecutive
              failed deliveries the endpoint is disabled automatically - re-enable it from Settings.
              Deliveries can occasionally arrive out of order or more than once, so dedupe on{' '}
              <code className="font-mono bg-gray-100 px-1 py-0.5 rounded">X-Qubesheets-Delivery</code>{' '}
              (or the envelope id) and treat each payload as a full snapshot of the current
              inventory - last write wins.
            </p>
          </section>
          )}

          {/* MCP server */}
          {!searching && (
          <section id="mcp" className="scroll-mt-24 rounded-xl bg-white p-6 shadow-sm ring-1 ring-gray-950/5">
            <h2 className="text-lg font-semibold mb-1">AI assistants (MCP server)</h2>
            <p className="text-sm text-gray-600">
              Qube Sheets runs a remote MCP server so AI assistants can work with your data directly:
              find projects, inventory with going-aware totals, AI walkthrough notes, and shareable
              links. Connectors are read-only by default; an org admin can enable actions (create
              projects, schedule/reschedule/cancel video calls - scheduling texts the customer their
              join link, exactly like the app). Everything is scoped to your organization, rate
              limited, and audit logged per tool call.
            </p>
            <ul className="mt-3 space-y-1">
              <li className="text-xs text-gray-600 flex gap-1.5">
                <span className="text-blue-500 mt-0.5">•</span>
                Set up from the app: Settings, then AI Connectors. An org admin mints a connector and
                gets a ready-to-paste URL. Treat that URL as a password; revoke it there anytime.
              </li>
              <li className="text-xs text-gray-600 flex gap-1.5">
                <span className="text-blue-500 mt-0.5">•</span>
                claude.ai / Claude Desktop ("No sign-in"), ChatGPT (Developer Mode, "No
                authentication"), and Grok (grok.com/connectors, Custom) all accept the connector
                URL directly.
              </li>
              <li className="text-xs text-gray-600 flex gap-1.5">
                <span className="text-blue-500 mt-0.5">•</span>
                Claude Code, Cursor, VS Code, Windsurf: point at the bearer endpoint and send your
                token as an Authorization header from an environment variable.
              </li>
            </ul>
            <div className="mt-4 grid gap-3 xl:grid-cols-2">
              <CodeBlock
                title="Endpoint (header auth)"
                code={`${baseUrl}/api/mcp\n\nAuthorization: Bearer ${PLACEHOLDER_KEY}`}
              />
              <CodeBlock
                title="Claude Code"
                code={`claude mcp add qubesheets ${baseUrl}/api/mcp \\\n  --header "Authorization: Bearer $QBS_MCP_TOKEN"`}
              />
            </div>
            <p className="mt-4 text-xs text-gray-500">
              Read tools: get_api_overview, find_project, list_projects, get_project, get_inventory,
              get_item_details, get_walkthrough_notes, get_project_link, list_video_calls,
              get_video_call, list_users. Action tools (admin-enabled connectors only):
              create_project, schedule_video_call, update_video_call, cancel_video_call. Everything
              the REST API can do is available, with one deliberate exception: video call join links
              are never exposed through MCP. Transport is streamable HTTP (MCP 2025-03 or newer
              clients).
            </p>
          </section>
          )}

          {/* Errors */}
          {!searching && (
          <section id="errors" className="scroll-mt-24 rounded-xl bg-white p-6 shadow-sm ring-1 ring-gray-950/5">
            <h2 className="text-lg font-semibold mb-1">Errors</h2>
            <p className="text-sm text-gray-600 mb-4">
              Errors always return <code className="text-xs font-mono bg-gray-100 px-1 py-0.5 rounded">{'{ "error", "message" }'}</code> with one of these status codes:
            </p>
            <div className="overflow-hidden rounded-xl ring-1 ring-gray-200">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 text-left text-[11px] uppercase tracking-wider text-gray-500">
                      <th className="px-4 py-2.5 font-semibold">Status</th>
                      <th className="px-4 py-2.5 font-semibold">Meaning</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {ERROR_ROWS.map((row) => (
                      <tr key={row.code} className="transition-colors hover:bg-gray-50/70">
                        <td className="px-4 py-2.5">
                          <code className="rounded-md bg-gray-100 px-1.5 py-0.5 font-mono text-xs font-medium text-gray-800">{row.code}</code>
                        </td>
                        <td className="px-4 py-2.5 text-xs text-gray-600">{row.meaning}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <p className="mt-4 text-xs text-gray-500">
              A machine-readable index of every endpoint is also available at{' '}
              <code className="font-mono bg-gray-100 px-1 py-0.5 rounded">GET {baseUrl}/api/external</code> (no auth required).
            </p>
          </section>
          )}
        </div>
        </div>

        <footer className="mt-12 border-t pt-6 pb-10 text-center text-xs text-gray-400">
          Qube Sheets - AI inventory for moving companies. Questions? Reach out to us for support.
        </footer>
      </main>
    </div>
  );
}
