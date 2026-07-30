import { createFileRoute } from "@tanstack/react-router";
import {
  Server,
  Globe,
  Lock,
  Route as RouteIcon,
  Shield,
  Gauge,
  Layers,
  Network,
  Database,
  Radio,
  Cable,
  ArrowRight,
  BookOpen,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import type { NodeType } from "@/services/api";
import {
  nodeDocs,
  nodeCategoryOrder,
  workflowExamples,
  apiSections,
  type NodeCategory,
} from "@/lib/docsData";

export const Route = createFileRoute("/_authenticated/docs")({
  head: () => ({
    meta: [
      { title: "Documentation · ProxyForge" },
      {
        name: "description",
        content: "How to design workflows, every node type, and the API contract.",
      },
    ],
  }),
  component: DocsPage,
});

const nodeIcon: Record<NodeType, typeof Server> = {
  Listener: Server,
  Domain: Globe,
  SSL: Lock,
  Route: RouteIcon,
  Auth: Shield,
  RateLimit: Gauge,
  Cache: Layers,
  LB: Network,
  Backend: Database,
  GRPC: Radio,
  TCP: Cable,
  UDP: Cable,
};

const difficultyVariant: Record<string, "default" | "secondary" | "outline"> = {
  Beginner: "secondary",
  Intermediate: "default",
  Advanced: "outline",
};

function CodeBlock({ children }: { children: string }) {
  return (
    <pre className="rounded-md bg-muted px-3 py-2 text-xs leading-relaxed overflow-x-auto font-mono">
      {children}
    </pre>
  );
}

function DocsPage() {
  const byCategory = (cat: NodeCategory) => nodeDocs.filter((n) => n.category === cat);

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
          <BookOpen className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Documentation</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            How the visual canvas works, what each node compiles to, worked examples, and the
            backend API contract.
          </p>
        </div>
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="nodes">Node reference</TabsTrigger>
          <TabsTrigger value="examples">Workflow examples</TabsTrigger>
          <TabsTrigger value="api">API reference</TabsTrigger>
        </TabsList>

        {/* -------------------- Overview -------------------- */}
        <TabsContent value="overview" className="space-y-4">
          <Card className="p-6 space-y-4">
            <div className="text-sm font-medium">What ProxyForge is</div>
            <p className="text-sm text-muted-foreground leading-relaxed">
              ProxyForge is a visual editor for nginx reverse-proxy configuration. Instead of
              hand-editing nginx.conf, you build a graph of nodes on the Workspace canvas — each
              node represents one piece of nginx behavior (a listener, a hostname match, a TLS cert,
              a rate limit, an upstream…) — and ProxyForge compiles that graph into a real
              nginx.conf on Deploy.
            </p>
          </Card>

          <Card className="p-6 space-y-4">
            <div className="text-sm font-medium">Designing a workflow, step by step</div>
            <ol className="space-y-3 text-sm text-muted-foreground">
              <li>
                <span className="font-medium text-foreground">1. Start a workflow.</span> From
                Workspace, create a new workflow. It opens on an empty canvas.
              </li>
              <li>
                <span className="font-medium text-foreground">2. Drag nodes from the palette.</span>{" "}
                Nodes are grouped Entry / Routing / Upstream / L4 Stream on the left. Drop one onto
                the canvas to add it.
              </li>
              <li>
                <span className="font-medium text-foreground">3. Connect them.</span> Drag from a
                node's output handle to another node's input handle. Only valid nginx relationships
                are allowed — see the "Connects to" line on each node in the reference tab; an
                invalid connection is rejected with an explanation.
              </li>
              <li>
                <span className="font-medium text-foreground">4. Configure properties.</span> Click
                a node to open its Property Panel and fill in fields like port, hostnames, or
                upstream address.
              </li>
              <li>
                <span className="font-medium text-foreground">5. Preview the compiled config.</span>{" "}
                Use the nginx preview to see the exact config your graph produces before it goes
                live.
              </li>
              <li>
                <span className="font-medium text-foreground">6. Deploy.</span> Deploying writes the
                compiled config and reloads nginx. Every deploy is a new version — roll back from
                the Versions dialog if something's wrong.
              </li>
            </ol>
          </Card>

          <Card className="p-6 space-y-3">
            <div className="text-sm font-medium">The four node groups</div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="rounded-md border p-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Entry
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Listener, Domain, SSL — where traffic enters and how it's identified/secured.
                </p>
              </div>
              <div className="rounded-md border p-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Routing
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Route, Auth, RateLimit, Cache — path matching and per-path policy.
                </p>
              </div>
              <div className="rounded-md border p-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Upstream
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  LB, Backend, GRPC — where traffic actually goes.
                </p>
              </div>
              <div className="rounded-md border p-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  L4 Stream
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  TCP, UDP — non-HTTP passthrough, bypasses Listener/Domain entirely.
                </p>
              </div>
            </div>
          </Card>
        </TabsContent>

        {/* -------------------- Node reference -------------------- */}
        <TabsContent value="nodes" className="space-y-6">
          {nodeCategoryOrder.map((cat) => (
            <div key={cat} className="space-y-2">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {cat}
              </div>
              <Card className="p-2">
                <Accordion type="single" collapsible>
                  {byCategory(cat).map((doc) => {
                    const Icon = nodeIcon[doc.type];
                    return (
                      <AccordionItem key={doc.type} value={doc.type} className="px-3">
                        <AccordionTrigger>
                          <div className="flex items-center gap-2">
                            <Icon className="h-4 w-4 text-muted-foreground" />
                            <span>{doc.type}</span>
                            <span className="text-xs font-normal text-muted-foreground">
                              — {doc.tagline}
                            </span>
                          </div>
                        </AccordionTrigger>
                        <AccordionContent className="space-y-4">
                          <p className="text-sm text-muted-foreground leading-relaxed">
                            {doc.description}
                          </p>
                          <div className="flex flex-wrap items-center gap-2 text-xs">
                            <Badge variant="outline">from: {doc.connectsFrom}</Badge>
                            <ArrowRight className="h-3 w-3 text-muted-foreground" />
                            <Badge variant="outline">to: {doc.connectsTo}</Badge>
                          </div>
                          <div className="space-y-1.5">
                            <div className="text-xs font-medium">Key fields</div>
                            <ul className="space-y-1">
                              {doc.keyFields.map((f) => (
                                <li key={f.name} className="text-xs text-muted-foreground">
                                  <code className="rounded bg-muted px-1 py-0.5 font-mono text-foreground">
                                    {f.name}
                                  </code>{" "}
                                  — {f.desc}
                                </li>
                              ))}
                            </ul>
                          </div>
                          <div className="space-y-1.5">
                            <div className="text-xs font-medium">Example — {doc.example.title}</div>
                            <ul className="space-y-0.5">
                              {doc.example.details.map((d) => (
                                <li key={d} className="text-xs text-muted-foreground font-mono">
                                  {d}
                                </li>
                              ))}
                            </ul>
                            <CodeBlock>{doc.example.nginx}</CodeBlock>
                          </div>
                        </AccordionContent>
                      </AccordionItem>
                    );
                  })}
                </Accordion>
              </Card>
            </div>
          ))}
        </TabsContent>

        {/* -------------------- Workflow examples -------------------- */}
        <TabsContent value="examples" className="space-y-4">
          {workflowExamples.map((ex) => (
            <Card key={ex.id} className="p-6 space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <div className="text-sm font-medium">{ex.title}</div>
                <Badge variant={difficultyVariant[ex.difficulty]}>{ex.difficulty}</Badge>
              </div>
              <p className="text-sm text-muted-foreground leading-relaxed">{ex.scenario}</p>
              <div className="text-xs font-mono text-muted-foreground">{ex.nodeChain}</div>
              <div className="space-y-2">
                {ex.steps.map((s) => (
                  <div key={s.label} className="text-sm">
                    <span className="font-medium">{s.label}</span>{" "}
                    <span className="text-muted-foreground">{s.detail}</span>
                  </div>
                ))}
              </div>
              <div className="space-y-1.5">
                <div className="text-xs font-medium">Compiled nginx (excerpt)</div>
                <CodeBlock>{ex.nginxPreview}</CodeBlock>
              </div>
            </Card>
          ))}
        </TabsContent>

        {/* -------------------- API reference -------------------- */}
        <TabsContent value="api" className="space-y-4">
          <Card className="p-6 space-y-2">
            <div className="text-sm font-medium">Backend API</div>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Every page in the app reads through this API — nothing is hardcoded client-side. Auth:{" "}
              <code className="rounded bg-muted px-1 py-0.5 font-mono">
                Authorization: Bearer &lt;token&gt;
              </code>{" "}
              on every non-auth route. Full request/response shapes live in{" "}
              <code className="rounded bg-muted px-1 py-0.5 font-mono">frontend/API.md</code>.
            </p>
          </Card>
          {apiSections.map((section) => (
            <Card key={section.title} className="p-4">
              <div className="px-2 py-1 text-sm font-medium">{section.title}</div>
              <div className="divide-y divide-border">
                {section.endpoints.map((ep) => (
                  <div key={ep.method + ep.path} className="flex items-start gap-3 px-2 py-2">
                    <Badge variant="outline" className="mt-0.5 shrink-0 font-mono">
                      {ep.method}
                    </Badge>
                    <div>
                      <div className="font-mono text-xs">{ep.path}</div>
                      <div className="text-xs text-muted-foreground">{ep.desc}</div>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          ))}
        </TabsContent>
      </Tabs>
    </div>
  );
}
