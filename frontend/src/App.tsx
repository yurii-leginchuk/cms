import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import RootLayout from '@/layouts/RootLayout'
import SitesPage from '@/pages/SitesPage'
import SiteDetailPage from '@/pages/SiteDetailPage'
import SitePagesPage from '@/pages/SitePagesPage'
import SiteSchemasPage from '@/pages/SiteSchemasPage'
import SiteImagesPage from '@/pages/SiteImagesPage'
import SiteOptimizationPage from '@/pages/SiteOptimizationPage'
import SchemaDetailPage from '@/pages/SchemaDetailPage'
import SiteMetaPage from '@/pages/SiteMetaPage'
import MetaEditPage from '@/pages/MetaEditPage'
import SettingsPage from '@/pages/SettingsPage'
import PromptsPage from '@/pages/PromptsPage'
import SitePromptsPage from '@/pages/SitePromptsPage'
import SiteBriefPage from '@/pages/SiteBriefPage'
import SiteChatPage from '@/pages/SiteChatPage'
import SitePageSpeedPage from '@/pages/SitePageSpeedPage'
import ImpactPage from '@/pages/ImpactPage'
import ImpactPagesPage from '@/pages/ImpactPagesPage'
import ImpactKeywordsPage from '@/pages/ImpactKeywordsPage'
import UsagePage from '@/pages/UsagePage'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<RootLayout />}>
          <Route index element={<Navigate to="/sites" replace />} />
          <Route path="sites" element={<SitesPage />} />
          <Route path="sites/:id" element={<SiteDetailPage />} />
          <Route path="sites/:id/pages" element={<SitePagesPage />} />
          <Route path="sites/:id/schemas" element={<SiteSchemasPage />} />
          <Route path="sites/:id/schemas/:pageId" element={<SchemaDetailPage />} />
          <Route path="sites/:id/images" element={<SiteImagesPage />} />
          <Route path="sites/:id/optimization" element={<SiteOptimizationPage />} />
          <Route path="sites/:id/meta" element={<SiteMetaPage />} />
          <Route path="sites/:id/meta/:pageId" element={<MetaEditPage />} />
          <Route path="sites/:id/prompts" element={<SitePromptsPage />} />
          <Route path="sites/:id/brief" element={<SiteBriefPage />} />
          <Route path="sites/:id/chat" element={<SiteChatPage />} />
          <Route path="sites/:id/pagespeed" element={<SitePageSpeedPage />} />
          <Route path="sites/:id/impact" element={<ImpactPage />} />
          <Route path="sites/:id/impact/pages" element={<ImpactPagesPage />} />
          <Route path="sites/:id/impact/keywords" element={<ImpactKeywordsPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="settings/prompts" element={<PromptsPage />} />
          <Route path="settings/usage" element={<UsagePage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
