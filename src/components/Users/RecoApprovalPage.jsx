import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useData } from '../../context/DataContext.jsx';
import RecoApprovalModal from './RecoApprovalModal.jsx';

/* Standalone entry point for "Set Recommendator & Approval", reached via its
   own nav link + pageKey (recoApprovalConfig) rather than through the full
   User Management page — lets a departmentHead/branchManager use just this
   one capability without being granted the broader Staff Details page (which
   stays gated to admin/branchManager via requireManager on /users). Reuses
   the same modal component UserManagement.jsx opens, so both entry points
   share one implementation; filteredEmployees is already scoped to the
   viewer's branch/department by DataContext (via AuthContext's
   filterByRole), same as it is for the /users entry point. */
const RecoApprovalPage = () => {
  const navigate = useNavigate();
  const { filteredEmployees } = useData();

  return (
    <div className="page-container">
      <RecoApprovalModal
        employees={filteredEmployees}
        onClose={() => navigate('/dashboard')}
      />
    </div>
  );
};

export default RecoApprovalPage;
