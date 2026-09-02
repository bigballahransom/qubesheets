// lib/dashboard-capture.ts - capture-type classification for VideoRecording docs.
//
// Historical nuance: virtual-call recordings usually have NO `source` field;
// customer self-serve AND admin/manual uploads both carry source 'self_serve'.
// Admin uploads are only identifiable by their roomId prefix. The persisted
// `captureType` field (written by new code) wins when present; this heuristic
// covers everything created before it existed.

export type CaptureType = 'virtual' | 'self_serve' | 'on_site';

// $addFields stage producing `_captureType` on VideoRecording aggregations
export const CAPTURE_TYPE_ADD_FIELDS = {
  $addFields: {
    _captureType: {
      $ifNull: [
        '$captureType',
        {
          $switch: {
            branches: [
              {
                case: { $regexMatch: { input: { $ifNull: ['$roomId', ''] }, regex: /^admin-upload-/ } },
                then: 'on_site',
              },
              {
                case: { $regexMatch: { input: { $ifNull: ['$roomId', ''] }, regex: /^self-serve-/ } },
                then: 'self_serve',
              },
              { case: { $eq: ['$source', 'self_serve'] }, then: 'self_serve' },
            ],
            default: 'virtual',
          },
        },
      ],
    },
  },
};

// Recording statuses that represent a real captured session (not failures/abandons)
export const COMPLETED_RECORDING_STATUSES = ['completed', 'partial'];
