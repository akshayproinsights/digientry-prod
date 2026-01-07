import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from './contexts/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import Layout from './components/Layout';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import UploadPage from './pages/UploadPage';
import ReviewInvoiceDetailsPage from './pages/ReviewInvoiceDetailsPage';
import VerifiedInvoicesPage from './pages/VerifiedInvoicesPage';
import InventoryUploadPage from './pages/InventoryUploadPage';
import VerifyPartsPage from './pages/VerifyPartsPage';
import VendorMappingPage from './pages/VendorMappingPage';
import InventoryMappedPage from './pages/InventoryMappedPage';
import CurrentStockPage from './pages/CurrentStockPage';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route
              path="/"
              element={
                <ProtectedRoute>
                  <Layout />
                </ProtectedRoute>
              }
            >
              {/* Dashboard */}
              <Route index element={<DashboardPage />} />

              {/* Sales Section */}
              <Route path="sales/upload" element={<UploadPage />} />
              <Route path="sales/review" element={<ReviewInvoiceDetailsPage />} />
              <Route path="sales/verified" element={<VerifiedInvoicesPage />} />

              {/* Inventory Section */}
              <Route path="inventory/stock" element={<CurrentStockPage />} />
              <Route path="inventory/upload" element={<InventoryUploadPage />} />
              <Route path="inventory/verify" element={<VerifyPartsPage />} />
              <Route path="inventory/mapping" element={<VendorMappingPage />} />
              <Route path="inventory/mapped" element={<InventoryMappedPage />} />

              {/* Legacy routes - redirect to new paths */}
              <Route path="upload" element={<Navigate to="/sales/upload" replace />} />
              <Route path="review/dates" element={<Navigate to="/sales/review" replace />} />
              <Route path="review/amounts" element={<Navigate to="/sales/review" replace />} />
              <Route path="sales/review/dates" element={<Navigate to="/sales/review" replace />} />
              <Route path="sales/review/amounts" element={<Navigate to="/sales/review" replace />} />
              <Route path="verified" element={<Navigate to="/sales/verified" replace />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
