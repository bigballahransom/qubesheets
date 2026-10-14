// app/api/external/route.ts
//
// GET /api/external - public documentation index for the partner API.
// (The per-endpoint self-doc that used to live on GET /api/external/projects
// moved here when that route became the real projects list.)

import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({
    name: 'Qube Sheets External API',
    authentication: {
      type: 'Bearer Token',
      header: 'Authorization: Bearer qbs_keyId_secret',
      note: 'Get your API key from the Settings > API Keys page. Keys are scoped to your organization.',
    },
    conventions: {
      ids: 'All id fields are 24-character hex strings.',
      dates: 'All timestamps are ISO 8601 (UTC).',
      units: 'Volume in cubic feet (cuft), weight in pounds (lbs). Inventory item cuft/weight are per-unit; total fields are per-unit × quantity.',
      errors: 'Errors return { error, message } with status 400/401/404/500.',
    },
    endpoints: [
      {
        method: 'POST',
        path: '/api/external/projects',
        description: 'Create a project. Optionally sends the customer an upload link by SMS when a phone number is provided.',
        body: { required: ['customerName'], optional: ['phone (10 digits)'] },
      },
      {
        method: 'GET',
        path: '/api/external/projects',
        description: "List your organization's projects, most recently updated first.",
        query: {
          page: 'Page number, default 1',
          limit: 'Page size, default 25, max 100',
          updatedSince: 'ISO 8601 timestamp - only projects updated at/after this time. Use for change polling.',
        },
      },
      {
        method: 'GET',
        path: '/api/external/projects/{projectId}/inventory',
        description: 'Inventory items plus a summary block. Summary figures are going-aware and match the Qube Sheets project page exactly. Item cuftPerUnit/weightPerUnitLbs are per-unit; totalCuft/totalWeightLbs are per-unit × quantity.',
      },
      {
        method: 'GET',
        path: '/api/external/projects/{projectId}/ai-summary',
        description: 'AI walkthrough summary per completed recording.',
      },
      {
        method: 'GET',
        path: '/api/external/projects/{projectId}/packing-notes',
        description: 'AI packing notes per completed recording.',
      },
      {
        method: 'GET',
        path: '/api/external/projects/{projectId}/customer-statements',
        description: 'Customer statements (transcript highlights) per completed recording: { text, timestamp, relatedItem }.',
      },
      {
        method: 'GET',
        path: '/api/external/projects/{projectId}/customer-review-link',
        description: 'Active customer inventory-review URL plus signature status. Creates the link on first call; never rotates an existing active link; sends nothing to the customer.',
      },
      {
        method: 'GET',
        path: '/api/external/projects/{projectId}/crew-review-link',
        description: 'Active crew review URL. Creates the link on first call; never rotates an existing active link.',
      },
      {
        method: 'GET',
        path: '/api/external/projects/{projectId}/self-survey-link',
        description: 'Active customer self-survey (video walkthrough) URL. Creates one with a 7-day expiry if none exists; replaces expired links; sends nothing.',
      },
      {
        method: 'GET',
        path: '/api/external/projects/{projectId}/onsite-walkthrough-link',
        description: 'Active on-site walkthrough URL for your surveyor. Creates the link on first call; never expires; sends nothing.',
      },
      {
        method: 'POST',
        path: '/api/external/video-calls',
        description: 'Schedule a video call (new or existing project); sends the customer a confirmation SMS with their join link. Supports rep assignment via assignedToEmail/assignedToUserId. See the route itself for full documentation.',
      },
      {
        method: 'GET',
        path: '/api/external/video-calls',
        description: "List your organization's video calls. Filters: status, projectId, startDate, endDate, upcoming, assignedTo (user id or email), limit, skip.",
      },
      {
        method: 'GET',
        path: '/api/external/video-calls/{callId}',
        description: 'A single video call, including reminders already sent.',
      },
      {
        method: 'PATCH',
        path: '/api/external/video-calls/{callId}',
        description: 'Reschedule (scheduledFor, timezone - sends a reschedule SMS) and/or reassign (assignedToEmail/assignedToUserId - no SMS) a scheduled call.',
      },
      {
        method: 'DELETE',
        path: '/api/external/video-calls/{callId}',
        description: 'Cancel a scheduled call. Optional body { "sendSms": true } texts the customer a cancellation notice.',
      },
      {
        method: 'GET',
        path: '/api/external/users',
        description: 'List organization members - use id/email for video-call assignment.',
      },
    ],
  });
}
