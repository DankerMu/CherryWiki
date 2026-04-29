import { Navigate } from 'react-router';

export default function Admin() {
  return <Navigate to="/admin/users" replace />;
}
