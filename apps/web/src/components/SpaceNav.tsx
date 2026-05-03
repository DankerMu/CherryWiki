import { NavLink } from 'react-router';

type SpaceNavProps = {
  spaceId: string;
};

const SPACE_NAV_ITEMS = [
  { label: 'Wiki', path: 'wiki' },
  { label: 'Chat', path: 'chat' },
  { label: 'Uploads', path: 'uploads' },
  { label: 'Graphify', path: 'graphify' },
] as const;

export default function SpaceNav({ spaceId }: SpaceNavProps) {
  return (
    <nav className="space-nav" aria-label="Space navigation">
      {SPACE_NAV_ITEMS.map((item) => (
        <NavLink
          key={item.path}
          to={`/spaces/${encodeURIComponent(spaceId)}/${item.path}`}
          className={({ isActive }) => (isActive ? 'space-nav-link active' : 'space-nav-link')}
        >
          {item.label}
        </NavLink>
      ))}
    </nav>
  );
}
