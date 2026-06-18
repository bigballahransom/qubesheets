// features/lead-intake/lib/validators.ts
//
// Zod schema for the full lead-form field set (POC fields minus photo/video).
// `name` + `email` are required; everything else is optional. Unknown keys are
// stripped (zod's default object behavior, made explicit with .strip()).
import { z } from 'zod';

export const leadSubmissionSchema = z
  .object({
    name: z.string().trim().min(1, 'Name is required').max(200),
    email: z.string().trim().email('A valid email is required').max(200),
    phone: z.string().trim().max(50).optional(),
    phoneType: z.string().trim().max(50).optional(),
    origin: z.string().trim().max(500).optional(),
    destination: z.string().trim().max(500).optional(),
    moveDate: z.string().trim().max(100).optional(),
    moveSize: z.string().trim().max(100).optional(),
    notes: z.string().trim().max(5000).optional(),
  })
  .strip();

export type LeadSubmissionInput = z.infer<typeof leadSubmissionSchema>;
