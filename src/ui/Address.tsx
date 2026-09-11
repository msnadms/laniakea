import { useUIStore } from "../store/uiStore"
import './Address.css'

const COORD_TYPES = new Set(['supercluster', 'galaxy', 'system']);

export function Address() {
    const address = useUIStore((s) => s.address)

    const coords = address
        .filter(s => COORD_TYPES.has(s.type))
        .map(s => `${Math.round(s.x)}.${Math.round(s.y)}.${Math.round(s.z)}`)
        .join(':');

    return (
        <div className="address">
            <div className="address-breadcrumb">
                {address?.map((segment, i) => (
                    <span key={i}>
                        {i > 0 && <span className="address-separator">›</span>}
                        <span className={`address-segment${i === address.length - 1 ? ' address-segment--current' : ''}`}>
                            {segment.name}
                        </span>
                    </span>
                ))}
            </div>
            {coords && <div className="address-coords">{coords}</div>}
        </div>
    )
}
