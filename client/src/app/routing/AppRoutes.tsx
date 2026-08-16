// Every route the application mounts.
//
// Moved out of App.tsx unchanged: same paths, same elements, same governed
// gating, same order. A route declaration may move between files; what a route
// MEANS may not change, and nothing here changes it.
//
// The governed routes are mounted only when the deployment is governed. That is
// not a permission check — it is a configuration fact. When the governed
// surfaces are switched off those pages have no backend to talk to, so they are
// not mounted and, correspondingly, not advertised by the navigation model.
//
// There is deliberately no role-based route hiding. The application does not
// have per-role route visibility today, and inventing it here would enforce
// authorization rules that no server actually applies — a lock on the menu, not
// on the door.

import { Route, Routes } from 'react-router-dom';
import Dashboard from '../../pages/Dashboard';
import Inventory from '../../pages/Inventory';
import Purchases from '../../pages/Purchases';
import CostLinks from '../../pages/CostLinks';
import Listings from '../../pages/Listings';
import Sales from '../../pages/Sales';
import Checks from '../../pages/Checks';
import ImportReview from '../../pages/ImportReview';
import AcquisitionReview from '../../pages/AcquisitionReview';
import InventoryIdentity from '../../pages/InventoryIdentity';
import IntakeHub from '../../pages/IntakeHub';
import BatchIntake from '../../pages/BatchIntake';
import LotDetail from '../../pages/LotDetail';
import ScanFind from '../../pages/ScanFind';
import Workbench from '../../pages/Workbench';
import CurrentInventory from '../../pages/CurrentInventory';
import BulkMove from '../../pages/BulkMove';
import Corrections from '../../pages/Corrections';
import ItemDetail from '../../pages/ItemDetail';
import IntakeSessions from '../../pages/IntakeSessions';
import Locations from '../../pages/Locations';
import CycleCounts from '../../pages/CycleCounts';
import MediaIssues from '../../pages/MediaIssues';
import ListingPrep from '../../pages/ListingPrep';
import ListingPrepDetail from '../../pages/ListingPrepDetail';
import Acquisitions from '../../pages/Acquisitions';
import Receiving from '../../pages/Receiving';
import ReceiptWorkspace from '../../pages/ReceiptWorkspace';
import Cost from '../../pages/Cost';
import CostComponentWorkspace from '../../pages/CostComponentWorkspace';
import AcquisitionDetail from '../../pages/AcquisitionDetail';

export function AppRoutes({ provenanceEnabled }: { provenanceEnabled: boolean }) {
  return (
    <Routes>
      <Route path="/" element={<Dashboard />} />
      <Route path="/inventory" element={<Inventory />} />
      <Route path="/purchases" element={<Purchases />} />
      <Route path="/cost-links" element={<CostLinks />} />
      <Route path="/listings" element={<Listings />} />
      <Route path="/sales" element={<Sales />} />
      <Route path="/checks" element={<Checks />} />
      {provenanceEnabled && <Route path="/quick-add" element={<IntakeHub />} />}
      {provenanceEnabled && <Route path="/batch-intake" element={<BatchIntake />} />}
      {provenanceEnabled && <Route path="/workbench" element={<Workbench />} />}
      {provenanceEnabled && <Route path="/scan" element={<ScanFind />} />}
      {provenanceEnabled && <Route path="/inventory/lots/:lotId" element={<LotDetail />} />}
      {provenanceEnabled && <Route path="/inventory/current" element={<CurrentInventory />} />}
      {provenanceEnabled && <Route path="/inventory/move" element={<BulkMove />} />}
      {provenanceEnabled && <Route path="/corrections" element={<Corrections />} />}
      {provenanceEnabled && <Route path="/inventory/current/:itemId" element={<ItemDetail />} />}
      {provenanceEnabled && <Route path="/intake-sessions" element={<IntakeSessions />} />}
      {provenanceEnabled && <Route path="/locations" element={<Locations />} />}
      {provenanceEnabled && <Route path="/cycle-counts" element={<CycleCounts />} />}
      {provenanceEnabled && <Route path="/photo-issues" element={<MediaIssues />} />}
      {provenanceEnabled && <Route path="/listing-prep" element={<ListingPrep />} />}
      {provenanceEnabled && <Route path="/listing-prep/:prepId" element={<ListingPrepDetail />} />}
      {provenanceEnabled && <Route path="/receiving" element={<Receiving />} />}
      {provenanceEnabled && <Route path="/receiving/:receiptPublicId" element={<ReceiptWorkspace />} />}
      {provenanceEnabled && <Route path="/cost" element={<Cost />} />}
      {provenanceEnabled && <Route path="/cost/:componentPublicId" element={<CostComponentWorkspace />} />}
      {provenanceEnabled && <Route path="/acquisitions" element={<Acquisitions />} />}
      {provenanceEnabled && <Route path="/acquisitions/:sourceSystemPublicId/:linePublicId" element={<AcquisitionDetail />} />}
      {provenanceEnabled && <Route path="/acquisitions/:publicId" element={<div className="p-6" role="alert"><h1>Legacy acquisition link</h1><p>This link is not source-qualified. Return to the acquisition list to select the governed source record.</p></div>} />}
      {provenanceEnabled && <Route path="/import-review" element={<ImportReview />} />}
      {provenanceEnabled && <Route path="/acquisition-review" element={<AcquisitionReview />} />}
      {provenanceEnabled && <Route path="/inventory-identity" element={<InventoryIdentity />} />}
    </Routes>
  );
}
