// lib/weight-config.ts
//
// Shared resolver for the per-project / per-org weight configuration so every
// surface (spreadsheet, customer review, crew review, PDF, SmartMoving sync,
// Supermove sync) computes inventory weights consistently.
//
// Precedence: project override → organization default → "actual" with a 7×
// multiplier as the final fallback.

import OrganizationSettings from '@/models/OrganizationSettings';

export interface WeightConfig {
  weightMode: 'actual' | 'custom';
  customWeightMultiplier: number;
}

export const DEFAULT_WEIGHT_CONFIG: WeightConfig = {
  weightMode: 'actual',
  customWeightMultiplier: 7,
};

export interface WeightConfigSources {
  project?: { weightMode?: string | null; customWeightMultiplier?: number | null } | null;
  organizationId?: string | null;
}

export async function resolveWeightConfig(
  sources: WeightConfigSources
): Promise<WeightConfig> {
  const project = sources.project;

  if (project?.weightMode) {
    return {
      weightMode: project.weightMode as 'actual' | 'custom',
      customWeightMultiplier: project.customWeightMultiplier || 7,
    };
  }

  if (sources.organizationId) {
    const orgSettings = await OrganizationSettings.findOne({
      organizationId: sources.organizationId,
    }).lean<{ weightMode?: string; customWeightMultiplier?: number }>();

    if (orgSettings?.weightMode) {
      return {
        weightMode: orgSettings.weightMode as 'actual' | 'custom',
        customWeightMultiplier: orgSettings.customWeightMultiplier || 7,
      };
    }
  }

  return { ...DEFAULT_WEIGHT_CONFIG };
}

export interface WeightInputs {
  cuft?: number | null;
  weight?: number | null;
}

export function resolveItemWeight(
  item: WeightInputs,
  config: WeightConfig
): number {
  if (config.weightMode === 'custom') {
    return (item.cuft || 0) * config.customWeightMultiplier;
  }
  return item.weight || 0;
}
