import type { DistrictDefinition, DistrictId, JobType } from '../game/types';
import raw from './districts.json';

export const DISTRICTS = raw.districts as unknown as DistrictDefinition[];
export const DISTRICT_BY_ID = Object.fromEntries(DISTRICTS.map(district => [district.id, district])) as Record<DistrictId, DistrictDefinition>;
export const DEFAULT_JOB_PRIORITY = DISTRICTS.flatMap(district => district.job ? [district.job] : []).filter((job, index, jobs) => jobs.indexOf(job) === index) as JobType[];
export const ANCHOR_DISTRICT = Object.fromEntries(DISTRICTS.filter(district => district.anchor).map(district => [district.anchor!, district.id])) as Record<string, DistrictId>;

export const LEGACY_DISTRICT_ID: Record<string, DistrictId> = {
  agri_dome: 'farm_district',
  habitat_block: 'civilian_district',
  gene_clinic: 'civilian_district',
  research_campus: 'research_district',
  deep_survey_array: 'research_district',
};

export function getDistrict(id: string): DistrictDefinition | undefined {
  return DISTRICTS.find(district => district.id === id);
}
