import { useId, useState } from 'react';
import type { AppView } from '../store/uiStore';
import { useUIStore } from '../store/uiStore';
import './TutorialPanel.css';

type TutorialSection = {
  title: string;
  items: string[];
};

type TutorialContent = {
  title: string;
  intro: string;
  sections: TutorialSection[];
};

const TUTORIAL_CONTENT: Record<AppView, TutorialContent> = {
  supercluster: {
    title: 'Supercluster View',
    intro: 'Survey the cosmic web and choose a galaxy to explore.',
    sections: [
      {
        title: 'Navigate',
        items: [
          'Drag to pan and scroll to zoom through the supercluster.',
          'Hold Shift while dragging, or use the right mouse button, to rotate the cosmic web and reveal its depth.',
          'Zoom in and select a galaxy to enter it and record it in your Codex.',
        ],
      },
      {
        title: 'Go further',
        items: [
          'JUMP generates a new supercluster to explore.',
          'The Codex lists every supercluster, galaxy, and star you have visited, and can take you back to any of them.',
        ],
      },
    ],
  },
  galaxy: {
    title: 'Galaxy View',
    intro: 'Chart star systems and pick one to visit.',
    sections: [
      {
        title: 'Explore',
        items: [
          'Drag to pan and scroll to zoom around the galaxy.',
          'Hold Shift while dragging, or use the right mouse button, to turn the disk.',
          'Select a star to enter its system and add it to your Codex.',
          'Use Back to return to the surrounding supercluster.',
        ],
      },
    ],
  },
  system: {
    title: 'System View',
    intro: 'Watch worlds orbit their star and inspect them.',
    sections: [
      {
        title: 'Survey',
        items: [
          'Select a planet to see its orbital zone and moons.',
          'Turn on Orbit Rings in Settings to trace each orbit.',
          'Use Back to return to the galaxy when you are finished in this system.',
        ],
      },
    ],
  },
};

export function TutorialPanel() {
  const view = useUIStore((state) => state.view);
  const tutorial = TUTORIAL_CONTENT[view];
  const [expanded, setExpanded] = useState(false);
  const panelId = useId();

  return (
    <div className="tutorial-control">
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
            <span className="tutorial-card-eyebrow">Current page</span>
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
