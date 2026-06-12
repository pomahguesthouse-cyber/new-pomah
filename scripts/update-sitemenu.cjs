const fs = require("fs");

let content = fs.readFileSync("src/routes/admin/pages.tsx", "utf8");

// Add props to SiteMenu
content = content.replace(
  "function SiteMenu({",
  `function SiteMenu({
  activeMenuTab,
  onMenuTabChange,`
);

content = content.replace(
  "pages: SeoLandingPage[];",
  `activeMenuTab: "PAGES" | "GLOBAL";
  onMenuTabChange: (tab: "PAGES" | "GLOBAL") => void;
  pages: SeoLandingPage[];`
);

// Add the Tabs UI inside SiteMenu
const tabsUI = `      <div className="flex p-2 bg-stone-100 border-b border-border">
        <button 
          onClick={() => onMenuTabChange("GLOBAL")}
          className={\`flex-1 text-xs font-semibold py-1.5 rounded-md transition \${activeMenuTab === "GLOBAL" ? "bg-white shadow-sm text-stone-900" : "text-stone-500 hover:text-stone-700"}\`}>
          GLOBAL
        </button>
        <button 
          onClick={() => onMenuTabChange("PAGES")}
          className={\`flex-1 text-xs font-semibold py-1.5 rounded-md transition \${activeMenuTab === "PAGES" ? "bg-white shadow-sm text-stone-900" : "text-stone-500 hover:text-stone-700"}\`}>
          PAGES
        </button>
      </div>

      {activeMenuTab === "PAGES" && (
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <p className="text-sm font-semibold">Site Menu</p>
          <button type="button" onClick={onAdd}
            className="flex items-center gap-1 text-xs font-medium text-teal-700 hover:text-teal-900">
            <Plus className="h-3.5 w-3.5" /> Add Page
          </button>
        </div>
      )}
      
      {activeMenuTab === "GLOBAL" && (
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <p className="text-sm font-semibold">Global Sections</p>
        </div>
      )}
`;

content = content.replace(
  /<aside className="flex w-64 shrink-0 flex-col border-r border-border bg-card">([\s\S]*?)<div className="border-b border-border p-2">/,
  `<aside className="flex w-64 shrink-0 flex-col border-r border-border bg-card">
${tabsUI}
      {activeMenuTab === "PAGES" && (
      <div className="border-b border-border p-2">`
);

// Add closing tags and GLOBAL content
content = content.replace(
  /<\/aside>/,
  `      )}
      
      {activeMenuTab === "GLOBAL" && (
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          <div
            className={cn("group flex items-center gap-2 rounded-lg px-2.5 py-2 cursor-pointer transition", activePageId === "global-header" ? "bg-teal-50 border border-teal-200" : "hover:bg-muted")}
            onClick={() => onSelect("global-header")}>
            <LayoutPanelTop className="h-3.5 w-3.5 shrink-0 text-stone-500" />
            <span className="flex-1 truncate text-xs font-medium text-stone-700">Header</span>
          </div>
          <div
            className={cn("group flex items-center gap-2 rounded-lg px-2.5 py-2 cursor-pointer transition", activePageId === "global-footer" ? "bg-teal-50 border border-teal-200" : "hover:bg-muted")}
            onClick={() => onSelect("global-footer")}>
            <LayoutPanelTop className="h-3.5 w-3.5 shrink-0 text-stone-500" />
            <span className="flex-1 truncate text-xs font-medium text-stone-700">Footer</span>
          </div>
          <div
            className={cn("group flex items-center gap-2 rounded-lg px-2.5 py-2 cursor-pointer transition", activePageId === "global-whatsapp" ? "bg-teal-50 border border-teal-200" : "hover:bg-muted")}
            onClick={() => onSelect("global-whatsapp")}>
            <MessageSquare className="h-3.5 w-3.5 shrink-0 text-stone-500" />
            <span className="flex-1 truncate text-xs font-medium text-stone-700">WhatsApp Float</span>
          </div>
          <div
            className={cn("group flex items-center gap-2 rounded-lg px-2.5 py-2 cursor-pointer transition", activePageId === "global-cookie" ? "bg-teal-50 border border-teal-200" : "hover:bg-muted")}
            onClick={() => onSelect("global-cookie")}>
            <Check className="h-3.5 w-3.5 shrink-0 text-stone-500" />
            <span className="flex-1 truncate text-xs font-medium text-stone-700">Cookie Banner</span>
          </div>
        </div>
      )}
    </aside>`
);

// Provide activeMenuTab prop from HomepageBuilder
content = content.replace(
  "const [activePageId, setActivePageId] = useState<string>(\"home\");",
  `const [activePageId, setActivePageId] = useState<string>("home");
  const [activeMenuTab, setActiveMenuTab] = useState<"PAGES" | "GLOBAL">("PAGES");`
);

content = content.replace(
  "<SiteMenu\n          pages={pages}",
  `<SiteMenu
          activeMenuTab={activeMenuTab}
          onMenuTabChange={setActiveMenuTab}
          pages={pages}`
);

fs.writeFileSync("src/routes/admin/pages.tsx", content);
console.log("Updated pages.tsx successfully.");
