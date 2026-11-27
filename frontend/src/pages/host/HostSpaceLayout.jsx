import { NavLink, Outlet, useParams, Link } from 'react-router-dom';
import Icon from '../../components/Icon.jsx';
import { ManageScope } from '../../manage/ManageScope.jsx';

/** /host/:spaceId/* — the shared management pages, scoped to one of the host's spaces (D24). */
export default function HostSpaceLayout() {
  const { spaceId } = useParams();
  const base = `/host/${spaceId}`;
  return (
    <ManageScope linkBase={base} apiBase="/host" spaceId={spaceId}>
      <div className="stack">
        <div className="row row-between">
          <Link to="/host" className="btn btn-ghost btn-sm"><Icon name="home" size={16} /> Your spaces</Link>
          <nav className="tabs host-tabs" aria-label="Manage this space">
            <NavLink end to={base} className="tab">Dashboard</NavLink>
            <NavLink to={`${base}/gate`} className="tab">Gate</NavLink>
            <NavLink to={`${base}/slots`} className="tab">Spots</NavLink>
            <NavLink to={`${base}/settings`} className="tab">Settings</NavLink>
          </nav>
        </div>
        <Outlet key={spaceId} />
      </div>
    </ManageScope>
  );
}
