import { Link, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard,
  Workflow,
  Rocket,
  ShieldCheck,
  Activity,
  FileText,
  Settings,
  Zap,
  BookOpen,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";

const main = [
  { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard },
  { title: "Workspace", url: "/workspace", icon: Workflow },
  { title: "Deployments", url: "/deployments", icon: Rocket },
  { title: "Certificates", url: "/certificates", icon: ShieldCheck },
];

const observability = [
  { title: "Metrics", url: "/metrics", icon: Activity },
  { title: "Logs", url: "/logs", icon: FileText },
];

const system = [
  { title: "Settings", url: "/settings", icon: Settings },
  { title: "Documentation", url: "/docs", icon: BookOpen },
];

export function AppSidebar() {
  const currentPath = useRouterState({ select: (r) => r.location.pathname });
  const isActive = (p: string) => currentPath === p || (p !== "/" && currentPath.startsWith(p));

  const section = (label: string, items: typeof main) => (
    <SidebarGroup>
      <SidebarGroupLabel>{label}</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map((item) => (
            <SidebarMenuItem key={item.title}>
              <SidebarMenuButton asChild isActive={isActive(item.url)}>
                <Link to={item.url} className="flex items-center gap-2">
                  <item.icon className="h-4 w-4" />
                  <span>{item.title}</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <div className="flex items-center gap-2 px-2 py-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Zap className="h-4 w-4" />
          </div>
          <div className="flex flex-col leading-tight group-data-[collapsible=icon]:hidden">
            <span className="text-sm font-semibold tracking-tight">ProxyForge</span>
            <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
              Visual Nginx
            </span>
          </div>
        </div>
      </SidebarHeader>
      <SidebarContent>
        {section("Platform", main)}
        {section("Observability", observability)}
        {section("System", system)}
      </SidebarContent>
    </Sidebar>
  );
}
