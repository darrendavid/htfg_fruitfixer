import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from '@/contexts/AuthContext'
import { Toaster } from '@/components/ui/sonner'
import { LoginPage } from '@/pages/LoginPage'
import { RegisterPage } from '@/pages/RegisterPage'
import { AdminLoginPage } from '@/pages/AdminLoginPage'
import { CheckEmailPage } from '@/pages/CheckEmailPage'
import { SwipePage } from '@/pages/SwipePage'
import { ClassifyPage } from '@/pages/ClassifyPage'
import { LeaderboardPage } from '@/pages/LeaderboardPage'
import { AdminDashboardPage } from '@/pages/AdminDashboardPage'
import { OcrReviewPage } from '@/pages/OcrReviewPage'
import { PlantGridPage } from '@/pages/PlantGridPage'
import { PlantDetailPage } from '@/pages/PlantDetailPage'

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/check-email" element={<CheckEmailPage />} />
          <Route path="/admin/login" element={<AdminLoginPage />} />
          <Route path="/swipe" element={<SwipePage />} />
          <Route path="/classify" element={<ClassifyPage />} />
          <Route path="/ocr-review" element={<OcrReviewPage />} />
          <Route path="/leaderboard" element={<LeaderboardPage />} />
          <Route path="/plants" element={<PlantGridPage />} />
          <Route path="/plants/:id" element={<PlantDetailPage />} />
          <Route path="/admin" element={<AdminDashboardPage />} />
          <Route path="/" element={<Navigate to="/swipe" replace />} />
          <Route path="*" element={<Navigate to="/swipe" replace />} />
        </Routes>
        <Toaster position="top-center" />
      </BrowserRouter>
    </AuthProvider>
  )
}
