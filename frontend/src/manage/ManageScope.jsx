// Which space the shared management pages (dashboard, gate, slots, settings) work on.
// Admin: /admin/*, API /api/admin (any space). Host: /host/:spaceId/*, API /api/host?space_id=.
import { createContext, useContext } from 'react';
import { setManageScope } from '../api/parkit.js';

const ManageContext = createContext({ linkBase: '/admin', spaceId: null, isHost: false });

export function ManageScope({ linkBase, apiBase, spaceId = null, children }) {
  // Set before the pages below render and fetch; idempotent, so safe in StrictMode.
  setManageScope({ base: apiBase, spaceId });
  return (
    <ManageContext.Provider value={{ linkBase, spaceId, isHost: apiBase === '/host' }}>
      {children}
    </ManageContext.Provider>
  );
}

export const useManage = () => useContext(ManageContext);
