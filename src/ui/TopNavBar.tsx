import './TopNavBar.css';

export function TopNavBar() {
  return (
    <div className="top-nav-bar" aria-hidden="true">
      <svg className="top-nav-ol top-nav-ol-left" xmlns="http://www.w3.org/2000/svg">
        <polyline
          vectorEffect="non-scaling-stroke"
          points="0,56 80,56 128,28"
          fill="none"
          stroke="rgba(0, 190, 230, 0.55)"
          strokeWidth="1"
        />
      </svg>
      <div className="top-nav-ol-center" />
      <svg className="top-nav-ol top-nav-ol-right" xmlns="http://www.w3.org/2000/svg">
        <polyline
          vectorEffect="non-scaling-stroke"
          points="0,28 48,56 128,56"
          fill="none"
          stroke="rgba(0, 190, 230, 0.55)"
          strokeWidth="1"
        />
      </svg>
    </div>
  );
}
