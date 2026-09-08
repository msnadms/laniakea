import { useMilestoneStore } from '../store/milestoneStore';
import { getMilestone } from '../game/milestones';
import './MilestonePopup.css';

export function MilestonePopup() {
  const id = useMilestoneStore((s) => s.popupQueue[0] ?? null);
  if (!id) return null;

  const milestone = getMilestone(id);

  return (
    <div className="milestone-overlay" role="dialog" aria-modal="true">
      <div className="milestone-dialog">
        <div className="milestone-label">Milestone</div>
        <div className="milestone-title">{milestone.title}</div>
        <p className="milestone-flavor">{milestone.flavor}</p>
        <button
          className="milestone-dismiss"
          onClick={() => useMilestoneStore.getState().dismissPopup()}
        >
          Continue
        </button>
      </div>
    </div>
  );
}
