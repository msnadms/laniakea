import type { ReactElement } from 'react';
import type { DistrictId } from '../game/types';

const props = {
  xmlns: 'http://www.w3.org/2000/svg',
  viewBox: '0 0 48 48',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

const FarmIcon = () => (
  <svg {...props}>
    <path d="M8 32a16 16 0 0 1 32 0" />
    <path d="M5 32h38" />
    <path d="M24 32V19" />
    <path d="M24 26c-5 0-8-2-8-6 5 0 8 2 8 6Z" />
    <path d="M24 23c4 0 7-2 7-5-4 0-7 2-7 5Z" />
    <path d="M9 38h30" />
    <path d="M13 43h22" />
  </svg>
);

const CivilianIcon = () => (
  <svg {...props}>
    <path d="M4 42V22l11-8 11 8v20" />
    <path d="M26 42V26l9-6 9 6v16" />
    <path d="M2 42h44" />
    <path d="M11 42v-9h8v9" />
    <path d="M32 29h6" />
    <path d="M32 35h6" />
    <path d="M15 8v5" />
  </svg>
);

const ResearchIcon = () => (
  <svg {...props}>
    <circle cx="24" cy="24" r="3.5" />
    <ellipse cx="24" cy="24" rx="19" ry="7.5" />
    <ellipse cx="24" cy="24" rx="19" ry="7.5" transform="rotate(60 24 24)" />
    <ellipse cx="24" cy="24" rx="19" ry="7.5" transform="rotate(120 24 24)" />
  </svg>
);

const DefenseIcon = () => (
  <svg {...props}>
    <path d="M24 4 8 10v13c0 9.5 6.8 17 16 21 9.2-4 16-11.5 16-21V10L24 4Z" />
    <path d="M24 16v15" />
    <path d="M16.5 23.5h15" />
  </svg>
);

const ICONS: Record<DistrictId, () => ReactElement> = {
  farm_district: FarmIcon,
  civilian_district: CivilianIcon,
  research_district: ResearchIcon,
  defense_district: DefenseIcon,
};

export function DistrictIcon({ id }: { id: DistrictId }) {
  const Icon = ICONS[id];
  return Icon ? <Icon /> : null;
}
