import { ICON_PATHS } from './iconPaths';

const VIEWBOX = '0 -960 960 960';

export const AlloysIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox={VIEWBOX} fill="currentColor">
    <path d={ICON_PATHS.alloys} />
  </svg>
);

export const NutrientsIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox={VIEWBOX} fill="currentColor">
    <path d={ICON_PATHS.nutrients} />
  </svg>
);

export const MetallicHydrogenIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox={VIEWBOX} fill="currentColor">
    <path d={ICON_PATHS.metallicHydrogen} />
  </svg>
);

export const NeutronStarMatterIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox={VIEWBOX} fill="currentColor">
    <path d={ICON_PATHS.neutronStarMatter} />
  </svg>
);

export const ExoticMatterIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox={VIEWBOX} fill="currentColor">
    <path d={ICON_PATHS.exotic} />
  </svg>
);

export const Helium3Icon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox={VIEWBOX} fill="currentColor">
    <path d={ICON_PATHS['helium-3']} />
  </svg>
);

export const MultiSystemIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox={VIEWBOX} fill="currentColor">
    <path d={ICON_PATHS.multiSystem} />
  </svg>
);

export const UpgradeModuleIcon = ({ size = 20 }: { size?: number }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox={VIEWBOX} fill="currentColor">
    <path d={ICON_PATHS.upgradeModule} />
  </svg>
);

export const AmenitiesIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox={VIEWBOX} fill="currentColor">
    <path d={ICON_PATHS.amenities} />
  </svg>
);
