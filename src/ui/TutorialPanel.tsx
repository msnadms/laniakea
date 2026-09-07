import { useId, useState } from 'react';
import type { AppView } from '../store/uiStore';
import { useUIStore } from '../store/uiStore';
import './TutorialPanel.css';

export type TutorialPage = AppView | 'logistics';

type TutorialSection = {
  title: string;
  items: string[];
};

type TutorialContent = {
  eyebrow: string;
  title: string;
  intro: string;
  sections: TutorialSection[];
};

const TUTORIAL_CONTENT: Record<TutorialPage, TutorialContent> = {
  supercluster: {
    eyebrow: 'Current page',
    title: 'Supercluster View',
    intro: 'Survey the cosmic web and choose a galaxy to explore.',
    sections: [
      {
        title: 'Navigate',
        items: [
          'Drag to pan and scroll to zoom through the supercluster.',
          'Hold Shift while dragging, or use the right mouse button, to rotate the cosmic web and reveal its depth.',
          'Zoom in and select a galaxy to travel there and record it in your Codex.',
        ],
      },
      {
        title: 'Ship controls',
        items: [
          'The JUMP control generates a new supercluster once your drive is upgraded enough.',
          'Watch Exotic Matter and Helium-3 in the ship HUD; travel consumes both resources.',
        ],
      },
    ],
  },
  galaxy: {
    eyebrow: 'Current page',
    title: 'Galaxy View',
    intro: 'Chart star systems and decide where the ship should travel next.',
    sections: [
      {
        title: 'Explore',
        items: [
          'Drag to pan and scroll to zoom around the galaxy map.',
          'Select a star to travel to its system and add the destination to your Codex.',
          'Use Back to return to the surrounding supercluster.',
        ],
      },
      {
        title: 'Plan your route',
        items: [
          'Travel costs Exotic Matter and Helium-3. More distant destinations cost more fuel.',
          'Previously visited locations can be revisited from the Codex.',
        ],
      },
    ],
  },
  system: {
    eyebrow: 'Current page',
    title: 'System View',
    intro: 'Inspect worlds, harvest resources, and build the production network.',
    sections: [
      {
        title: 'Survey',
        items: [
          'Select a planet or moon to inspect its deposits and available surface operations.',
          'Use Back to return to the galaxy map when you are finished in this system.',
        ],
      },
      {
        title: 'Build and collect',
        items: [
          'Spend alloys to build extraction stations on resource deposits, then collect their stored cargo.',
          'Settled planets can operate fabricators that turn raw cargo into materials, modules, and advanced assemblies.',
          'Station capacity and production options expand through the Ship Workshop.',
        ],
      },
    ],
  },
  logistics: {
    eyebrow: 'Panel tutorial',
    title: 'Logistics Network',
    intro: 'Connect stations into directed drone routes that collect cargo and feed fabricators.',
    sections: [
      {
        title: 'Create a route',
        items: [
          'Unlock Extraction Logistics in the Ship Workshop, then choose New Route.',
          'Drag from one map node to another to create a directed link. Select a link to remove it.',
          'Every node must belong to one connected, cycle-free network before the route can be saved.',
        ],
      },
      {
        title: 'Control the flow',
        items: [
          'Cargo follows the arrows from sources toward fabricators. Edge policies control filters, priorities, reserves, and surplus routing.',
          'The dry run reports expected batches, edge use, shortages, fuel cost, and route risk. Risk over 3 adds 1 probe attention on dispatch.',
          'Activate a valid route for automatic dispatches, or use Dispatch to run it immediately.',
        ],
      },
      {
        title: 'Inspect the network',
        items: [
          'Select a node for station or fabricator details. Use the right-side tabs for reserves, materials, and modules.',
          'Route fuel floors protect ship reserves, while logistics upgrades add stations, route slots, and material bandwidth.',
        ],
      },
    ],
  },
};

export function TutorialPanel({ page, overlay = false }: { page?: TutorialPage; overlay?: boolean }) {
  const currentView = useUIStore((state) => state.view);
  const activePage = page ?? currentView;
  const tutorial = TUTORIAL_CONTENT[activePage];
  const [expanded, setExpanded] = useState(false);
  const panelId = useId();

  return (
    <div className={`tutorial-control${overlay ? ' tutorial-control--overlay' : ''}`}>
      <button
        type="button"
        className={`tutorial-trigger${expanded ? ' tutorial-trigger--open' : ''}`}
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
        aria-controls={panelId}
      >
        <span className="tutorial-trigger-icon" aria-hidden="true">?</span>
        <span className="tutorial-trigger-label">Tutorial</span>
        <span className="tutorial-trigger-context">{tutorial.title}</span>
        <span className="tutorial-trigger-chevron" aria-hidden="true">{expanded ? '▲' : '▼'}</span>
      </button>

      {expanded && (
        <aside id={panelId} className="tutorial-card" aria-label={`${tutorial.title} tutorial`}>
          <div className="tutorial-card-heading">
            <span className="tutorial-card-eyebrow">{tutorial.eyebrow}</span>
            <strong>{tutorial.title}</strong>
          </div>
          <p className="tutorial-card-intro">{tutorial.intro}</p>
          {tutorial.sections.map((section) => (
            <section className="tutorial-card-section" key={section.title}>
              <h3>{section.title}</h3>
              <ol>
                {section.items.map((item) => <li key={item}>{item}</li>)}
              </ol>
            </section>
          ))}
        </aside>
      )}
    </div>
  );
}
