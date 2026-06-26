// lib/leads/crm/registry.ts
import { smartmoving } from './smartmoving';
import { supermove } from './supermove';
import { chariot } from './chariot';
import type { CrmAdapter } from './types';

export const adapters: CrmAdapter[] = [smartmoving, supermove, chariot];
