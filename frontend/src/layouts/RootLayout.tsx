import { NavLink, Outlet, useLocation, matchPath } from 'react-router-dom'
import { Globe, LayoutDashboard, LayoutList, Tag, Settings, BookOpen, MessageSquare, BarChart2, FileText, BotMessageSquare, Gauge, TrendingUp, Files, Braces, Image as ImageIcon, Zap, ScanSearch, CheckSquare, Signpost } from 'lucide-react'
import { Toaster } from '@/components/ui/sonner'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'

const topNavItems = [
  { to: '/sites', label: 'Sites', icon: Globe },
]

function SidebarIcon({
  to,
  label,
  icon: Icon,
  end,
}: {
  to: string
  label: string
  icon: React.ElementType
  end?: boolean
}) {
  return (
    <Tooltip>
      {/* The NavLink IS the trigger (no wrapper div): the tooltip follows real
          hover/focus on the link, so it also shows on keyboard navigation and
          `aria-describedby` lands on the interactive element. */}
      <TooltipTrigger
        render={
          <NavLink
            to={to}
            end={end}
            aria-label={label}
            className={({ isActive }) =>
              cn(
                'size-9 flex items-center justify-center rounded-lg transition-colors',
                isActive
                  ? 'bg-[#4e8af4]/15 text-[#4e8af4]'
                  : 'text-[#9aa0a6] hover:text-[#e8eaed] hover:bg-white/5',
              )
            }
          >
            <Icon className="size-4" />
          </NavLink>
        }
      />
      <TooltipContent side="right" sideOffset={10}>
        {label}
      </TooltipContent>
    </Tooltip>
  )
}

export default function RootLayout() {
  const location = useLocation()
  const siteMatch =
    matchPath('/sites/:id', location.pathname) ||
    matchPath('/sites/:id/*', location.pathname)
  const siteId = siteMatch?.params?.id

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: 'var(--background)' }}>
      {/* Sidebar - icon-only */}
      <aside
        className="w-14 flex-shrink-0 flex flex-col items-center border-r py-3 gap-1"
        style={{ background: 'var(--sidebar)', borderColor: 'var(--sidebar-border)' }}
      >
        {/* Logo */}
        <div className="size-8 rounded-lg bg-[#4e8af4] flex items-center justify-center mb-3 mt-1 flex-shrink-0">
          <LayoutDashboard className="size-4 text-white" />
        </div>

        <div className="w-6 h-px bg-white/8 mb-1 flex-shrink-0" />

        {/* Top navigation */}
        {topNavItems.map(({ to, label, icon }) => (
          <SidebarIcon key={to} to={to} label={label} icon={icon} />
        ))}

        {/* Site sub-navigation */}
        {siteId && (
          <>
            <Separator className="w-6 bg-white/8 my-1" />
            <SidebarIcon
              to={`/sites/${siteId}`}
              label="Overview"
              icon={LayoutList}
              end
            />
            <SidebarIcon
              to={`/sites/${siteId}/pages`}
              label="Pages"
              icon={Files}
            />
            <SidebarIcon
              to={`/sites/${siteId}/schemas`}
              label="Schemas"
              icon={Braces}
            />
            <SidebarIcon
              to={`/sites/${siteId}/images`}
              label="Image ALT"
              icon={ImageIcon}
            />
            <SidebarIcon
              to={`/sites/${siteId}/optimization`}
              label="Image Optimization"
              icon={Zap}
            />
            <SidebarIcon
              to={`/sites/${siteId}/meta`}
              label="Meta Management"
              icon={Tag}
            />
            <SidebarIcon
              to={`/sites/${siteId}/prompts`}
              label="Site Prompts"
              icon={MessageSquare}
            />
            <SidebarIcon
              to={`/sites/${siteId}/brief`}
              label="Site Brief"
              icon={FileText}
            />
            <SidebarIcon
              to={`/sites/${siteId}/chat`}
              label="AI Chat"
              icon={BotMessageSquare}
            />
            <SidebarIcon
              to={`/sites/${siteId}/impact`}
              label="Optimization Impact"
              icon={TrendingUp}
            />
            <SidebarIcon
              to={`/sites/${siteId}/pagespeed`}
              label="PageSpeed"
              icon={Gauge}
            />
            <SidebarIcon
              to={`/sites/${siteId}/index-status`}
              label="Index Status"
              icon={ScanSearch}
            />
            <SidebarIcon
              to={`/sites/${siteId}/redirects`}
              label="Redirects"
              icon={Signpost}
            />
            <SidebarIcon
              to={`/sites/${siteId}/tasks`}
              label="Tasks"
              icon={CheckSquare}
            />
          </>
        )}

        {/* Push to bottom */}
        <div className="flex-1" />

        <Separator className="w-6 bg-white/8 my-1" />
        <SidebarIcon to="/settings/usage" label="Token Usage" icon={BarChart2} end={false} />
        <SidebarIcon to="/settings/prompts" label="Prompt Library" icon={BookOpen} end={false} />
        <SidebarIcon to="/settings" label="Settings" icon={Settings} end={true} />
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto">
        <Outlet />
      </main>

      <Toaster theme="dark" />
    </div>
  )
}
